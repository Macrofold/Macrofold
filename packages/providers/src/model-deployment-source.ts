import { z } from 'zod';
import { safeFetch } from './network';
import { assert, AppError } from '../../core/src/errors';
import type { components } from '../../contracts/api';
import { defaultRuntimeParameters, runtimeCapabilities, servingImage } from '../../core/src/model-deployment-profiles';
type Source = components['schemas']['ModelDeploymentHuggingFaceSource'];
type Inspection = components['schemas']['ModelDeploymentInspection'];
const infoSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/), pipeline_tag: z.string().optional(),
  gated: z.union([z.boolean(), z.string()]).optional(),
  cardData: z.object({ license: z.union([z.string(),z.array(z.string())]).optional() }).passthrough().optional(),
  siblings: z.array(z.object({ rfilename: z.string(), size: z.number().optional(), lfs: z.object({size:z.number()}).passthrough().optional() })).max(20000),
}).passthrough();
const configSchema = z.object({
  architectures: z.array(z.string()).optional(), auto_map: z.unknown().optional(),
  num_hidden_layers: z.number().int().positive().optional(), num_key_value_heads: z.number().int().positive().optional(),
  num_attention_heads: z.number().int().positive().optional(), hidden_size: z.number().int().positive().optional(),
  head_dim: z.number().int().positive().optional(), max_position_embeddings:z.number().int().positive().optional(),
  quantization_config: z.object({quant_method:z.string().optional()}).passthrough().optional(),
}).passthrough();
export function normalizeHuggingFaceSource(input: Source): Source {
  let repository=input.repository, revision=input.revision;
  if (repository.startsWith('https://')) {
    const url=new URL(repository);
    assert(url.origin==='https://huggingface.co' && !url.username && !url.password && !url.search && !url.hash,
      400,'unsupported_model_source','Use a Hugging Face model repository URL without credentials, query or fragment.');
    const parts=url.pathname.replace(/\/$/,'').split('/').slice(1);
    assert(parts.length===2 || (parts.length===4 && parts[2]==='tree'),400,'unsupported_model_source','Use a model repository or its /tree/revision URL.');
    repository=parts.slice(0,2).join('/');
    if (parts[3]) {
      const ref=decodeURIComponent(parts[3]);
      assert(!revision || revision===ref,400,'unsupported_model_source','The URL revision and explicit revision must agree.');
      revision=ref;
    }
  }
  assert(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) && !repository.includes('..') && !/^(datasets|spaces)\//i.test(repository),400,'unsupported_model_source','Use owner/model for a model repository.');
  assert(!revision || (!revision.includes('..') && !/[\x00-\x20\\]/.test(revision)),400,'unsupported_model_source','Choose a valid explicit model revision.');
  for(const file of input.weight_files || []) assert(!file.startsWith('/') && !file.split('/').includes('..') && file.endsWith('.safetensors'),400,'unsupported_model_source','Select exact safetensors paths inside the repository.');
  return {...input,repository,...(revision?{revision}: {})};
}
async function metadata(path:string,secret?:string,optional=false):Promise<unknown> {
  const response=await safeFetch(`https://huggingface.co/${path}`,{headers:secret?{Authorization:`Bearer ${secret}`}:{},signal:AbortSignal.timeout(15000)});
  if(optional && response.status===404)return null;
  assert(response.ok,response.status===401 || response.status===403 ? 403 : response.status===404 ? 404 : 503,
    response.status===401 || response.status===403 ? 'model_source_access_denied' : 'deployment_provider_unavailable',
    'Hugging Face metadata is unavailable. Check the repository and this owner’s gated/private access.');
  return response.json();
}
export async function inspectHuggingFace(input: components['schemas']['ModelDeploymentInspectionInput'],secret?:string):Promise<Inspection> {
  const source=normalizeHuggingFaceSource(input.source);
  try {
    const info=infoSchema.parse(await metadata(`api/models/${source.repository}/revision/${encodeURIComponent(source.revision || 'main')}?blobs=true`,secret));
    const pinned={...source,revision:info.sha};
    const [rawConfig,tokenizer]=await Promise.all([
      metadata(`${source.repository}/resolve/${info.sha}/config.json`,secret,true),
      metadata(`${source.repository}/resolve/${info.sha}/tokenizer_config.json`,secret,true),
    ]);
    const findings:Inspection['findings']=[];
    const add=(code:string,message:string)=>findings.push({code,message});
    const parsed=configSchema.safeParse(rawConfig);
    if(!parsed.success)add('missing_model_config','A supported causal language-model configuration is required.');
    const c=parsed.success?parsed.data:{};
    const supported=new Set(['LlamaForCausalLM','MistralForCausalLM','Qwen2ForCausalLM','Qwen3ForCausalLM','Qwen3MoeForCausalLM','GemmaForCausalLM','Gemma2ForCausalLM','Gemma3ForCausalLM','Phi3ForCausalLM','GPTNeoXForCausalLM']);
    if(!c.architectures?.some(a=>supported.has(a)))add('unsupported_architecture','This architecture is not in the reviewed vLLM text profile. Use a compatible external endpoint.');
    if(c.auto_map)add('remote_code_required','Repository-defined model code is outside this managed runtime. Use a compatible external endpoint.');
    if(info.pipeline_tag && info.pipeline_tag!=='text-generation')add('unsupported_task','The initial managed profile serves text generation.');
    if(info.siblings.some(f=>f.rfilename==='adapter_config.json'))add('adapter_only_source','Select complete model weights rather than an adapter-only repository.');
    const weights=info.siblings.filter(f=>f.rfilename.endsWith('.safetensors'));
    if(!weights.length)add('unsupported_weight_format','This profile requires safetensors weights. GGUF and other engines can use an external endpoint.');
    if(!source.weight_files && weights.some(f=>f.rfilename.includes('/')))add('ambiguous_weight_variant','Select the exact weight_files for one compatible weight variant.');
    if(source.weight_files?.some(f=>!weights.some(w=>w.rfilename===f)))add('missing_weight_file','One selected safetensors file does not exist at this revision.');
    const selected=weights.filter(w=>!source.weight_files || source.weight_files.includes(w.rfilename));
    pinned.weight_files=selected.map(f=>f.rfilename);
    let tokenizerConfig=tokenizer;
    if(source.tokenizer) {
      const normalized=normalizeHuggingFaceSource({kind:'hugging_face',...source.tokenizer});
      const ti=infoSchema.parse(await metadata(`api/models/${normalized.repository}/revision/${encodeURIComponent(normalized.revision || 'main')}?blobs=true`,secret));
      pinned.tokenizer={repository:normalized.repository,revision:ti.sha};
      tokenizerConfig=await metadata(`${normalized.repository}/resolve/${ti.sha}/tokenizer_config.json`,secret,true);
    }
    if(!tokenizerConfig || typeof tokenizerConfig!=='object' || !('chat_template' in tokenizerConfig) || !tokenizerConfig.chat_template)add('missing_chat_template','The pinned tokenizer needs an existing chat template.');
    const parameters={...defaultRuntimeParameters,...input.runtime_preferences?.parameters};
    if(c.max_position_embeddings && parameters.context_window_tokens>c.max_position_embeddings)add('context_window_unsupported','The selected context exceeds the model configuration.');
    if(c.quantization_config?.quant_method && parameters.quantization!==c.quantization_config.quant_method)add('quantization_required',`Select the model’s ${c.quantization_config.quant_method} quantization if supported by the profile.`);
    const bytes=selected.every(w=>Number.isSafeInteger(w.lfs?.size ?? w.size))?selected.reduce((n,w)=>n+BigInt(w.lfs?.size ?? w.size ?? 0),0n):null;
    const dimension=c.head_dim ?? (c.hidden_size && c.num_attention_heads ? c.hidden_size/c.num_attention_heads : undefined);
    const kv=c.num_hidden_layers && (c.num_key_value_heads || c.num_attention_heads) && dimension
      ? 2*c.num_hidden_layers*(c.num_key_value_heads || c.num_attention_heads || 0)*dimension*2*parameters.context_window_tokens*parameters.max_concurrent_requests : null;
    const memory=bytes!==null && kv!==null && Number.isSafeInteger(kv) ? bytes*12n/10n+BigInt(kv)+2n*1024n**3n : null;
    const license=Array.isArray(info.cardData?.license)?info.cardData.license.join(', '):info.cardData?.license || null;
    return {supported:!findings.length,findings,source:pinned,runtime_profiles:findings.length?[]:[{profile_id:'vllm-0.32.0-text',image:servingImage,parameters,capabilities:runtimeCapabilities({profile_id:'vllm-0.32.0-text',parameters})}],hosting_options:[],memory_estimate_bytes:memory?.toString() ?? null,license,license_acknowledgement_required:!!info.gated || !!license};
  } catch(error) {
    if(error instanceof AppError)throw error;
    throw new AppError(503,'deployment_provider_unavailable','Hugging Face returned incomplete metadata or did not respond within the inspection deadline.');
  }
}
