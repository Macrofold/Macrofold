# The reviewed AMD64 artifact, rather than a movable release tag, owns engine dependencies.
FROM vllm/vllm-openai:v0.32.0@sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9
LABEL org.opencontainers.image.source="https://github.com/Macrofold/Macrofold" \
    org.opencontainers.image.description="Macrofold protected vLLM chat runtime; model weights configured separately"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --only-upgrade \
    dirmngr=2.4.4-2ubuntu17.6 gnupg=2.4.4-2ubuntu17.6 gnupg-utils=2.4.4-2ubuntu17.6 \
    gnupg2=2.4.4-2ubuntu17.6 gpg=2.4.4-2ubuntu17.6 gpg-agent=2.4.4-2ubuntu17.6 \
    gpgconf=2.4.4-2ubuntu17.6 gpgsm=2.4.4-2ubuntu17.6 gpgv=2.4.4-2ubuntu17.6 \
    keyboxd=2.4.4-2ubuntu17.6 openssl=3.0.13-0ubuntu3.16 libssl3t64=3.0.13-0ubuntu3.16 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/macrofold-model
COPY infra/model-serving/requirements.txt ./requirements.txt
COPY infra/model-serving/security-requirements.txt ./security-requirements.txt
COPY infra/model-serving/check_dependencies.py ./check_dependencies.py
# The base leaves an unused newer OTLP common package after LMCache selects the
# compatible 1.40 telemetry family. The graph check fails if anything requires it.
RUN python3 -m pip install --no-cache-dir --no-deps -r requirements.txt \
    && python3 -m pip install --no-cache-dir --no-deps --require-hashes --only-binary=:all: -r security-requirements.txt \
    && python3 -m pip uninstall -y opentelemetry-exporter-otlp-common uv \
    && python3 check_dependencies.py \
    # The fixed engine and Hub downloader never install packages at runtime.
    # Remove pip's vulnerable vendored build-tool graph, preserving engine dependencies.
    && python3 -m pip uninstall -y pip
COPY infra/model-serving/*.py ./
COPY LICENSE NOTICE /usr/local/share/licenses/macrofold/
RUN useradd --create-home --uid 10001 model && mkdir /models && chown model:model /models
USER model
ENV HF_HOME=/models/huggingface HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_IMPLICIT_TOKEN=1 DO_NOT_TRACK=1 VLLM_NO_USAGE_STATS=1
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/macrofold-model/server.py"]
