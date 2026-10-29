"""
Tests for the AgentService's pure helper functions.

These do not touch the LLM or Chroma — they test the small
routing/detection logic that decides how the agent handles a
given user message.
"""

from services.agent import AgentService


# ============================================================
# _is_small_talk
# ============================================================

def test_small_talk_detects_greetings():
    assert AgentService._is_small_talk("hi")
    assert AgentService._is_small_talk("hello")
    assert AgentService._is_small_talk("hey there")


def test_small_talk_detects_pleasantries():
    assert AgentService._is_small_talk("how are you?")
    assert AgentService._is_small_talk("thanks!")
    assert AgentService._is_small_talk("good morning")


def test_small_talk_rejects_document_questions():
    assert not AgentService._is_small_talk("what is the leave policy?")
    assert not AgentService._is_small_talk("summarize the IT document")
    assert not AgentService._is_small_talk("who manages software applications?")


def test_small_talk_rejects_empty_or_long():
    assert not AgentService._is_small_talk("")
    assert not AgentService._is_small_talk("   ")
    long_q = (
        "hi, I was wondering if you could help me understand the leave "
        "policy that was mentioned in the employee handbook"
    )
    assert not AgentService._is_small_talk(long_q)


def test_small_talk_case_insensitive():
    assert AgentService._is_small_talk("HELLO")
    assert AgentService._is_small_talk("Hi There")


# ============================================================
# _is_memory_question
# ============================================================

def test_memory_question_detects_recent_recall():
    assert AgentService._is_memory_question("what did I ask?")
    assert AgentService._is_memory_question("what was my previous question?")
    assert AgentService._is_memory_question("what have I asked so far?")


def test_memory_question_detects_recall_phrases():
    assert AgentService._is_memory_question("what did we discuss earlier?")
    assert AgentService._is_memory_question("show me my previous questions")
    assert AgentService._is_memory_question("recap our chat")


def test_memory_question_rejects_document_queries():
    assert not AgentService._is_memory_question("what is the leave policy?")
    assert not AgentService._is_memory_question("summarize the document")