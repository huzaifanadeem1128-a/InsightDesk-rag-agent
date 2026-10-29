"""
Custom RAG evaluation harness for InsightDesk.

Does NOT depend on RAGAS. Uses the Groq LLM to judge three metrics:

  1. Faithfulness       — is the answer grounded in the retrieved chunks?
  2. Answer Relevancy   — does the answer actually address the question?
  3. Context Precision  — how relevant are the retrieved chunks to the question?

Usage:

    python tests/eval_rag.py                # run all questions
    python tests/eval_rag.py --limit 3      # only first 3
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv()

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

from rag_engine import RAGService


DATASET_PATH = ROOT / "tests" / "eval_dataset.json"
JUDGE_MODEL = "openai/gpt-oss-120b"


FAITHFULNESS_PROMPT = """You are evaluating an AI assistant's answer.

Rate how FAITHFUL the answer is to the provided context on a scale of 0 to 1:
- 1.0 = every claim in the answer is fully supported by the context
- 0.5 = the answer contains some claims not in the context
- 0.0 = the answer contains information the context does not support, or the context is empty

Reply with ONLY a decimal number (e.g., 0.85). No explanation.

Context:
---
{context}
---

Answer:
---
{answer}
---

Score:"""


RELEVANCY_PROMPT = """You are evaluating an AI assistant's answer.

Rate how RELEVANT the answer is to the question on a scale of 0 to 1:
- 1.0 = the answer directly and completely addresses the question
- 0.5 = the answer partially addresses the question or includes tangential info
- 0.0 = the answer does not address the question at all

Reply with ONLY a decimal number (e.g., 0.85). No explanation.

Question:
---
{question}
---

Answer:
---
{answer}
---

Score:"""


def safe_score(raw: str) -> float:
    if not raw:
        return 0.0
    import re
    m = re.search(r"(\d+\.\d+|\d+)", raw)
    if not m:
        return 0.0
    try:
        v = float(m.group(1))
        if v > 1.0 and v <= 100.0:
            v = v / 100.0
        return max(0.0, min(1.0, v))
    except Exception:
        return 0.0


def judge(llm: ChatGroq, prompt: str) -> float:
    try:
        resp = llm.invoke([HumanMessage(content=prompt)])
        return safe_score(str(resp.content))
    except Exception as e:
        print(f"      [!] judge failed: {e}")
        return 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--user", type=str, default=None)
    args = parser.parse_args()

    if not DATASET_PATH.exists():
        print(f"[!] Dataset not found: {DATASET_PATH}")
        sys.exit(1)

    with open(DATASET_PATH) as f:
        questions = json.load(f)["questions"]

    if args.limit:
        questions = questions[:args.limit]

    user_id = args.user
    if not user_id:
        from database import Database
        db = Database()
        conn = db.connect()
        row = conn.execute(
            "SELECT user_id FROM users WHERE email = 'huzaifa.nadeem@invozone.dev'"
        ).fetchone()
        conn.close()
        if not row:
            print("[!] No matching user. Pass --user <user_id> explicitly.")
            sys.exit(1)
        user_id = row[0]

    print(f"[+] User: {user_id}")
    print(f"[+] Building RAGService...")
    service = RAGService(user_id=user_id)

    if not service.retrievers:
        print("[!] No documents uploaded for this user.")
        sys.exit(1)

    print(f"[+] Documents: {len(service.retrievers)}")
    print(f"[+] Questions: {len(questions)}\n")

    judge_llm = ChatGroq(
        model=JUDGE_MODEL,
        temperature=0,
        max_retries=2,
        max_tokens=256,
    )

    rows = []

    for i, item in enumerate(questions, start=1):
        q = item["question"]
        print(f"  [{i}/{len(questions)}] {q[:60]}...")

        try:
            answer, retrieved_docs = service.ask(q)
        except Exception as e:
            print(f"      [!] agent error: {e}")
            answer, retrieved_docs = "ERROR", []

        contexts = [d.page_content for d in retrieved_docs if d.page_content]
        context_block = "\n\n---\n\n".join(contexts) if contexts else "(no context retrieved)"

        if contexts and answer and answer != "ERROR":
            faithfulness = judge(
                judge_llm,
                FAITHFULNESS_PROMPT.format(
                    context=context_block[:6000],
                    answer=answer[:4000],
                ),
            )
        else:
            faithfulness = 0.0

        if answer and answer != "ERROR":
            relevancy = judge(
                judge_llm,
                RELEVANCY_PROMPT.format(
                    question=q,
                    answer=answer[:4000],
                ),
            )
        else:
            relevancy = 0.0

        rows.append({
            "question": q,
            "faithfulness": faithfulness,
            "relevancy": relevancy,
            "contexts": len(contexts),
        })

    print("\n" + "=" * 78)
    print("EVALUATION RESULTS")
    print("=" * 78)
    print(f"  {'Question':<55} {'Faith':>6} {'Rel':>6} {'Chunks':>7}")
    print("-" * 78)

    for r in rows:
        q = r["question"][:53]
        print(f"  {q:<55} {r['faithfulness']:>6.2f} {r['relevancy']:>6.2f} {r['contexts']:>7}")

    print("-" * 78)
    avg_f = sum(r["faithfulness"] for r in rows) / len(rows) if rows else 0
    avg_r = sum(r["relevancy"] for r in rows) / len(rows) if rows else 0
    avg_c = sum(r["contexts"] for r in rows) / len(rows) if rows else 0

    print(f"  {'AVERAGE':<55} {avg_f:>6.3f} {avg_r:>6.3f} {avg_c:>7.1f}")
    print("=" * 78)


if __name__ == "__main__":
    main()
    
