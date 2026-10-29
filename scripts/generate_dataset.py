#!/usr/bin/env python3
"""Generate fictional dialogue with Workers AI, then inject labeled test values.

An operator token is read from DATAFOG_GENERATOR_TOKEN or created in memory with
--bootstrap-token. Tokens are never written to the repository or printed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
GENERATOR_URL = "https://datafog-lance-context-generator.sid-5af.workers.dev"
SCENARIOS = [
    ("delivery", ["EMAIL", "PHONE"], "A delayed parcel; customer shares contact details and asks for a delivery update."),
    ("refund", ["CARD", "DATE", "ORDER"], "A duplicate charge; customer asks for a refund and shares the test card number."),
    ("account-recovery", ["SSN", "EMAIL"], "An account recovery request containing an identity number. Agent explains the recovery process without asking for more private data."),
    ("unicode", ["EMAIL", "PHONE"], "An international delivery question. Include an emoji and the words café and mañana without inventing a person's name."),
    ("connection", ["IP", "DATE", "ORDER"], "A customer reports a failed checkout from a documentation-only IP address."),
    ("support-contact", ["EMAIL", "PUBLIC_SUPPORT_EMAIL"], "Customer asks where to send a receipt; agent gives the public support email while acknowledging the private reply address."),
    ("clean-negative", ["DATE", "ORDER"], "A helpful product-return conversation that has no contact details. Preserve the return date and order number."),
    ("callback", ["PHONE", "EMAIL"], "Customer requests a callback and repeats their contact details; agent confirms the next step."),
]
ENTITY = {"EMAIL": "EMAIL", "PHONE": "PHONE", "SSN": "SSN", "CARD": "CREDIT_CARD", "IP": "IP_ADDRESS", "DATE": "DATE", "PUBLIC_SUPPORT_EMAIL": "EMAIL"}


def digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def generation_prompt() -> str:
    specifications = [{"scenario": name, "required_placeholders": ["{{" + p + "}}" for p in placeholders], "story": story} for name, placeholders, story in SCENARIOS]
    return (
        "Return a JSON object with a conversations array in exactly the following scenario order. "
        "Each item has scenario and messages. Each messages array contains a short natural support conversation, "
        "with role user or assistant and content text. Use every required placeholder literally at least once. "
        "Personal data MUST appear only as the exact placeholders. Do not invent any email, phone, personal name, "
        "street address, SSN, card number, IP address, date or order number; use placeholders. "
        "Use a fictional shop called Northstar Goods. Give each conversation a useful resolution. "
        "Do not use markdown. Scenarios: " + json.dumps(specifications)
    )


def token_for_operator(bootstrap: bool) -> str:
    existing = os.environ.get("DATAFOG_GENERATOR_TOKEN")
    if existing:
        return existing
    if not bootstrap:
        raise SystemExit("Set DATAFOG_GENERATOR_TOKEN or pass --bootstrap-token. The token is not printed.")
    token = secrets.token_urlsafe(48)
    command = ["npx", "--no-install", "wrangler", "secret", "put", "GENERATOR_TOKEN", "--config", "wrangler.generator.jsonc"]
    result = subprocess.run(command, input=token, text=True, capture_output=True, cwd=ROOT)
    if result.returncode:
        raise SystemExit("Could not save operator secret with Wrangler: " + result.stderr[-1500:])
    return token


def generate(token: str, url: str, prompt: str) -> dict:
    request = urllib.request.Request(url.rstrip("/") + "/admin/generate", data=json.dumps({"prompt": prompt}).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "DataFogSyntheticFixtureBuilder/0.1"}, method="POST")
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def parse_conversations(response: dict) -> list[dict]:
    value = response["result"]
    if isinstance(value, dict) and "response" in value:
        value = value["response"]
    if isinstance(value, str):
        value = json.loads(value)
    conversations = value["conversations"]
    if len(conversations) != len(SCENARIOS):
        raise ValueError("Model response does not cover the requested scenarios")
    for item, (scenario, required, _) in zip(conversations, SCENARIOS):
        if item.get("scenario") != scenario:
            raise ValueError("Model response changed scenario order")
        messages = item.get("messages")
        if not messages or any(m.get("role") not in {"user", "assistant"} or not isinstance(m.get("content"), str) for m in messages):
            raise ValueError("Model returned an invalid message shape")
        combined = "\n".join(m["content"] for m in messages)
        if any("{{" + placeholder + "}}" not in combined for placeholder in required):
            raise ValueError("Model omitted a required placeholder in " + scenario)
    return conversations


def inject(conversations: list[dict]) -> tuple[list[dict], list[dict]]:
    records, oracle = [], []
    for index, (item, (scenario, _, _)) in enumerate(zip(conversations, SCENARIOS), 1):
        values = {"EMAIL": f"customer-{index:03d}@example.com", "PHONE": f"(202) 555-{100 + index:04d}", "SSN": "123-45-6789", "CARD": "4111 1111 1111 1111", "IP": "192.0.2.44", "DATE": "2026-11-05", "ORDER": f"NS-{index:05d}", "PUBLIC_SUPPORT_EMAIL": "support@example.com"}
        messages = []
        occurrences = []
        for message_index, source in enumerate(item["messages"]):
            content = source["content"]
            for name, value in values.items():
                placeholder = "{{" + name + "}}"
                if placeholder in content:
                    occurrences.append({"path": f"/messages/{message_index}/content", "placeholder": name, "value": value, "entity_type": ENTITY.get(name), "public_exception": name == "PUBLIC_SUPPORT_EMAIL"})
                    content = content.replace(placeholder, value)
            if "{{" in content or "}}" in content:
                raise ValueError("Model returned an unknown placeholder")
            messages.append({"role": source["role"], "content": content})
        session = "session-" + scenario
        external = "ticket-" + scenario
        if scenario == "delivery":
            session = "session/" + values["EMAIL"]
        if scenario == "unicode":
            external = "ticket/" + values["EMAIL"]
        records.append({"schema_version": "1", "session_id": session, "tenant": "northstar-synthetic", "source": "workers-ai-synthetic-support", "external_id": external, "messages": messages, "metadata": {"scenario": scenario, "synthetic": True}})
        oracle.append({"scenario": scenario, "session_id": session, "message_values": occurrences, "metadata_canaries": [value for value in [session if "@" in session else None, external if "@" in external else None] if value], "negative_values": [values["ORDER"], values["DATE"]]})
    return records, oracle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap-token", action="store_true")
    parser.add_argument("--version", default="v1", help="Immutable fixture version, such as v2")
    parser.add_argument("--generator-url", default=GENERATOR_URL)
    parser.add_argument("--response-file", type=Path, help="Replay a saved real model response without spending credits")
    args = parser.parse_args()
    version = args.version
    if not re.fullmatch(r"v[1-9][0-9]*", version):
        raise SystemExit("Version must use the form v1, v2, ...")
    output = ROOT / f"data/support-conversations-{version}.jsonl"
    if output.exists():
        raise SystemExit(f"Immutable {version} already exists. Generate a new version rather than replacing its published bytes.")
    prompt = generation_prompt()
    response = json.loads(args.response_file.read_text()) if args.response_file else generate(token_for_operator(args.bootstrap_token), args.generator_url, prompt)
    (ROOT / f"data/generation-response-{version}.json").write_text(json.dumps(response, ensure_ascii=False, indent=2) + "\n")
    records, oracle = inject(parse_conversations(response))
    blob = ("\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in records) + "\n").encode()
    output.write_bytes(blob)
    oracle_bytes = (json.dumps({"synthetic": True, "note": "Known injected test cases, not measured real-world accuracy. Date/IP handling and the public support exception depend on policy.", "cases": oracle}, ensure_ascii=False, indent=2) + "\n").encode()
    provenance = {"synthetic": True, "fixture_version": version, "model": response["model"], "generated_at": response["generated_at"], "assembled_at": dt.datetime.now(dt.timezone.utc).isoformat(), "prompt_version": "v1", "prompt_sha256": digest(prompt.encode()), "model_response_sha256": digest(json.dumps(response, ensure_ascii=False, sort_keys=True).encode()), "dataset_sha256": digest(blob), "conversation_count": len(records), "message_count": sum(len(row["messages"]) for row in records), "generation": "Workers AI wrote placeholder dialogue; deterministic injector supplied labeled test-only values.", "fixture_notes": ["example.com email addresses are reserved examples", "202-555-0100 through 202-555-0199 are fictional telephone values", "4111 1111 1111 1111 is a payment-test card", "123-45-6789 is a public test-pattern identity number with no link to a person", "192.0.2.44 is a documentation-only IP address", "Free-text person names are outside the demo detector scope"]}
    for directory in [ROOT / "data/public/samples", ROOT / "ui/public/samples"]:
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output, directory / output.name)
        (directory / f"ground-truth-{version}.json").write_bytes(oracle_bytes)
        (directory / f"generation-provenance-{version}.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n")
    (ROOT / f"data/ground-truth-{version}.json").write_bytes(oracle_bytes)
    (ROOT / f"data/generation-provenance-{version}.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"dataset": str(output), "sha256": digest(blob), "conversations": len(records), "messages": provenance["message_count"], "model": response["model"]}))


if __name__ == "__main__":
    main()
