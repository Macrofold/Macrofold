"""Content-free runtime failures; never print arbitrary model/provider exceptions."""

import json
import re
import sys


class RuntimeFailure(Exception):
    def __init__(self, stage: str, code: str):
        super().__init__(code)
        self.stage = stage
        self.code = code


def failure(error: BaseException, stage: str, code: str):
    kind = type(error).__name__
    print(json.dumps({"component": "model_serving", "stage": error.stage if isinstance(error, RuntimeFailure) else stage,
                      "code": error.code if isinstance(error, RuntimeFailure) else code,
                      "error_type": kind if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", kind) else "Exception"}), file=sys.stderr, flush=True)
