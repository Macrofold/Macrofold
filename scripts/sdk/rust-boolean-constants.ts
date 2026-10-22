import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Generator 7.24 represents boolean consts as string enums. Keep the literal
 * type while serializing JSON booleans, including rejection of the other value. */
export function rustBooleanConstant(source: string, name: string, literal: boolean): string {
  const variant = literal ? 'True' : 'False';
  const before = `#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum ${name} {
    #[serde(rename = "${literal}")]
    ${variant},
}`;
  if (source.split(before).length !== 2)
    throw new Error(`Recheck Rust boolean constant generation: ${name}`);
  return source.replace(
    before,
    `#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(try_from = "bool", into = "bool")]
pub enum ${name} {
    ${variant},
}

impl TryFrom<bool> for ${name} {
    type Error = &'static str;

    fn try_from(value: bool) -> Result<Self, Self::Error> {
        if value == ${literal} {
            Ok(Self::${variant})
        } else {
            Err("Expected ${literal}")
        }
    }
}

impl From<${name}> for bool {
    fn from(_: ${name}) -> bool {
        ${literal}
    }
}`,
  );
}

export async function preserveRustBooleanConstants(output: string) {
  for (const [file, name, literal] of [
    ['model_deployment_cost_policy.rs', 'InfrastructureCostIncluded', false],
    ['model_deployment_hosting.rs', 'ExternalHostingAcknowledged', true],
    ['model_deployment_hosting_one_of_1.rs', 'ExternalHostingAcknowledged', true],
  ] as const) {
    const target = path.join(output, 'src/models', file);
    await writeFile(target, rustBooleanConstant(await readFile(target, 'utf8'), name, literal));
  }
}
