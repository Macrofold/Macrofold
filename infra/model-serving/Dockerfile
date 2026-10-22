# The reviewed AMD64 artifact, rather than a movable release tag, owns engine dependencies.
FROM vllm/vllm-openai:v0.32.0@sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9

WORKDIR /opt/macrofold-model
COPY infra/model-serving/requirements.txt ./requirements.txt
COPY infra/model-serving/check_dependencies.py ./check_dependencies.py
# The base leaves an unused newer OTLP common package after LMCache selects the
# compatible 1.40 telemetry family. The graph check fails if anything requires it.
RUN python3 -m pip install --no-cache-dir --no-deps -r requirements.txt && python3 -m pip uninstall -y opentelemetry-exporter-otlp-common && python3 check_dependencies.py
COPY infra/model-serving/*.py ./
RUN useradd --create-home --uid 10001 model && mkdir /models && chown model:model /models
USER model
ENV HF_HOME=/models/huggingface HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_IMPLICIT_TOKEN=1 DO_NOT_TRACK=1 VLLM_NO_USAGE_STATS=1
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/macrofold-model/server.py"]
