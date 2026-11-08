"""Exercise the real Rust process against an original, synthetic Linux C ABI.
No vendor library is used. Optional SITEF_SMOKE_TARGET=i686-unknown-linux-gnu exercises the Linux32 contract.
"""
import base64
import json
import os
import shlex
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
target = os.environ.get("SITEF_SMOKE_TARGET")
target_args = ["--target", target] if target else []
subprocess.run(["cargo", "build", "--manifest-path", str(ROOT / "Cargo.toml"), *target_args], check=True)
bridge = ROOT / "target" / (target or "") / "debug/sitef-bridge"
runner = shlex.split(os.environ.get("SITEF_SMOKE_RUNNER", ""))
compiler = shlex.split(os.environ.get("SITEF_SMOKE_CC", "cc"))
is_i686 = target == "i686-unknown-linux-gnu"
with tempfile.TemporaryDirectory(prefix="sitef-abi-test-") as directory:
    shared = Path(directory) / "libfixture.so"
    subprocess.run([*compiler, "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", str(ROOT / "tests/fixture.c"), "-o", str(shared)], check=True)
    process = subprocess.Popen([*runner, str(bridge)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    sequence = 0
    def request(method, params=None):
        global sequence
        sequence += 1
        process.stdin.write(json.dumps({"id":sequence,"method":method,"params":params or {}}) + "\n")
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        assert response["id"] == sequence, response
        return response
    def result(method, params=None):
        response = request(method, params)
        assert "error" not in response, response
        return response["result"]

    assert request("capabilities")["error"]["code"] == "NOT_LOADED"
    if is_i686:
        invalid = Path(directory) / "invalid.so"
        invalid.write_bytes(b"not an ELF")
        assert request("load", {"libraryPath":str(invalid)})["error"]["code"] == "INVALID_LIBRARY_FORMAT"
    else:
        assert request("load", {"libraryPath":str(shared)})["error"]["code"] == "UNSUPPORTED_PLATFORM"
    capabilities = result("load", {"libraryPath":str(shared),"testMode":not is_i686,"nativeEncoding":"windows-1252"})
    assert capabilities["minimumBufferSize"] == 20000
    assert capabilities["testMode"] is (not is_i686)
    if is_i686:
        assert capabilities["runtimeTarget"] == "linux-ia32"
        assert capabilities["architecture"] == "x86"
        assert capabilities["fieldTypeBytes"] == 4
    assert capabilities["functions"]["pinpadPresent"]["available"] is True
    assert capabilities["functions"]["pinpadKey"]["available"] is False
    assert capabilities["functions"]["configure"]["available"] is False
    assert capabilities["functions"]["configure"]["callable"] is True
    assert capabilities["functions"]["configureEx"]["available"] is True
    assert capabilities["functions"]["configureEx"]["callable"] is False
    assert capabilities["functions"]["configureEx"]["invocationMethod"] == "configure"
    assert capabilities["functions"]["readChipEx"]["callable"] is False
    assert capabilities["functions"]["readChipEx"]["invocationMethod"] == "readChip"
    assert capabilities["functions"]["pinpadInfo"]["callable"] is False
    assert request("pinpadInfo")["error"]["code"] == "UNVERIFIED_OUTPUT_BOUND"
    assert result("version")["interfaceVersion"]["text"] == "fixture-interface-1"
    assert request("start", {})["error"]["code"] == "NOT_CONFIGURED"
    config = {"server":"127.0.0.1","storeId":"00000000","terminalId":"AA123456","reserved":0,"additionalParameters":"[X=1]"}
    assert result("configure", config)["status"] == 0
    assert result("pendingCount", {"fiscalDate":"20261030","fiscalDocument":"123"})["count"] == 2
    assert result("pinpadPresent")["status"] == 1
    assert result("flushMessages")["status"] == -999
    assert result("validateBarcode", {"data":"123"}) == {"status":3,"documentType":1}
    invalid_key = request("readPasswordDirect", {"securityKey":"short"})
    assert invalid_key["error"]["code"] == "INVALID_PARAMETER", invalid_key
    assert result("readPasswordDirect", {"securityKey":"x"*64})["encryptedPassword"]["text"] == "synthetic-encrypted"
    start = {"functionId":0,"amount":"12,34","fiscalDocument":"123","fiscalDate":"20261030","fiscalTime":"120000","operator":"test","additionalParameters":"{X=1}"}
    assert result("start", start)["status"] == 10000
    assert request("configure", config)["error"]["code"] == "TRANSACTION_ACTIVE"
    assert request("continue", {"buffer":"","continueFlag":0,"bufferSize":19999})["error"]["code"] == "INVALID_BUFFER_SIZE"
    step = result("continue", {"buffer":"","continueFlag":0,"bufferSize":20000})
    assert step["command"] == 0 and step["fieldType"] == 121
    assert step["buffer"] == "Ação\n" and step["decodingError"] is False
    assert base64.b64decode(step["bufferBase64"]) == b"A\xe7\xe3o\n"
    step = result("continue", {"bufferBase64":step["bufferBase64"],"continueFlag":0,"bufferSize":20000})
    assert step["command"] == 30 and step["fieldType"] == 999123
    assert request("continue", {"buffer":"12345","continueFlag":0,"bufferSize":20000})["error"]["code"] == "INVALID_INPUT_LENGTH"
    assert result("continue", {"buffer":"1234","continueFlag":0,"bufferSize":20000})["status"] == 0
    finish = {"confirm":1,"fiscalDocument":"123","fiscalDate":"20261030","fiscalTime":"120000","additionalParameters":""}
    assert result("finish", finish) == {"returned":True}
    assert request("continue", {"buffer":"","continueFlag":0,"bufferSize":20000})["error"]["code"] == "NO_ACTIVE_TRANSACTION"
    assert result("start", start)["status"] == 10000
    assert result("continue", {"buffer":"","continueFlag":-1,"bufferSize":20000})["status"] == -2
    start["functionId"] = 999
    assert result("start", start)["status"] == -98765
    assert request("pinpadKey")["error"]["code"] == "MISSING_SYMBOL"
    process.stdin.write("invalid-json\n")
    process.stdin.flush()
    assert json.loads(process.stdout.readline())["error"]["code"] == "INVALID_REQUEST"
    assert result("capabilities")["protocolVersion"] == 1
    process.stdin.close()
    assert process.wait(timeout=5) == 0
    assert process.stderr.read() == ""
print("Native synthetic ABI/IPC smoke checks passed")
