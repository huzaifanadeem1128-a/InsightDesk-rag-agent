import re

from langchain_core.documents import Document


MIN_RELEVANCE_SCORE = 0.10


class RetrievalWrapper:

    def __init__(
        self,
        retriever,
        final_k: int,
        vector_store=None,     # optional: for semantic scoring
    ):
        self.retriever = retriever
        self.final_k = final_k
        self.vector_store = vector_store

    def invoke(
        self,
        query: str,
        top_k: int | None = None
    ) -> list[Document]:

        if not query.strip():
            raise ValueError("Search query cannot be empty")

        effective_k = (
            top_k if top_k is not None else self.final_k
        )

        # Preferred: get chunks WITH semantic relevance scores from Chroma.
        if self.vector_store is not None:
            try:
                candidate_k = max(effective_k * 4, 10)
                scored = self.vector_store.similarity_search_with_relevance_scores(
                    query, k=candidate_k
                )
                # Chroma returns [(Document, score), ...]
                docs = []
                for doc, score in scored:
                    doc.metadata["semantic_score"] = float(score)
                    docs.append(doc)

                if docs:
                    return rerank_documents(
                        query=query,
                        documents=docs,
                        top_k=effective_k,
                    )
            except Exception:
                # Fall through to the plain retriever if scoring failed.
                pass

        # Fallback: plain similarity search (no scores).
        try:
            candidates = self.retriever.invoke(query)
        except Exception as error:
            raise RuntimeError(
                f"Document retrieval failed: {error}"
            ) from error

        if not candidates:
            return []

        return rerank_documents(
            query=query,
            documents=candidates,
            top_k=effective_k,
        )

def _get_words(
    text: str
) -> set[str]:

    stop_words = {
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "what",
        "when",
        "where",
        "who",
        "why",
        "how",
        "did",
        "do",
        "does",
        "i",
        "me",
        "my",
        "we",
        "our",
        "you",
        "your",
        "it",
        "that",
        "this",
        "about",
        "tell",
        "show",
        "please",
        "can",
        "could",
        "would",
        "and",
        "or",
        "to",
        "of",
        "in",
        "on",
        "for",
        "with",
        "from",
        "be",
        "has",
        "have",
        "had",
    }

    tokens = re.findall(
        r"[a-zA-Z0-9]+",
        text.lower()
    )

    return {
        word
        for word in tokens
        if word
        and word not in stop_words
        and len(word) > 2
    }


def _normalize_text(
    text: str
) -> str:

    return " ".join(
        text.lower().split()
    )


def calculate_relevance_score(
    query: str,
    document: Document
) -> float:

    query_words = _get_words(
        query
    )

    document_words = _get_words(
        document.page_content
    )

    if not query_words or not document_words:
        return 0.0

    matching_words = (
        query_words
        & document_words
    )

    overlap_score = (
        len(matching_words)
        / len(query_words)
    )

    normalized_query = _normalize_text(
        query
    )

    normalized_content = _normalize_text(
        document.page_content
    )

    phrase_bonus = 0.0

    if normalized_query in normalized_content:
        phrase_bonus = 0.30

    score = (
        overlap_score
        + phrase_bonus
    )

    return min(
        score,
        1.0
    )


def remove_duplicate_documents(
    documents: list[Document]
) -> list[Document]:

    unique_documents = []
    seen = set()

    for document in documents:

        normalized_content = (
            _normalize_text(
                document.page_content
            )
        )

        document_id = document.metadata.get(
            "document_id",
            "unknown"
        )

        page = document.metadata.get(
            "page",
            "unknown"
        )

        key = (
            document_id,
            page,
            normalized_content
        )

        if key in seen:
            continue

        seen.add(key)

        unique_documents.append(
            document
        )

    return unique_documents


def filter_irrelevant_documents(
    documents: list[Document]
) -> list[Document]:

    return [
        document
        for document in documents
        if document.metadata.get(
            "relevance_score",
            0.0
        ) >= MIN_RELEVANCE_SCORE
    ]


def rerank_documents(
    query: str,
    documents: list[Document],
    top_k: int
) -> list[Document]:

    if not documents:
        return []

    unique_documents = remove_duplicate_documents(documents)

    scored_documents = []

    for document in unique_documents:

        # Semantic score from Chroma (0-1, higher = more similar).
        semantic = document.metadata.get("semantic_score")

        # Lexical fallback score.
        lexical = calculate_relevance_score(
            query=query,
            document=document,
        )

        if semantic is not None:
            # Blend: 85% semantic, 15% lexical (tiebreaker).
            score = 0.85 * float(semantic) + 0.15 * lexical
        else:
            # No semantic score available → use lexical only.
            score = lexical

        document.metadata["relevance_score"] = round(score, 4)
        document.metadata["semantic_score"] = semantic
        document.metadata["lexical_score"] = round(lexical, 4)

        scored_documents.append((score, document))

    scored_documents.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    return [
        document
        for score, document
        in scored_documents[:top_k]
    ]


def retrieve_documents(
    retrievers: dict,
    query: str
) -> list[Document]:

    if not retrievers:

        raise ValueError(
            "Please process documents before searching"
        )

    if not query.strip():

        raise ValueError(
            "Search query cannot be empty"
        )

    retrieved_documents = []

    for document_id, retriever in (
        retrievers.items()
    ):

        try:

            documents = retriever.invoke(
                query
            )

        except Exception as error:

            raise RuntimeError(
                "Failed to retrieve documents "
                f"for document '{document_id}': "
                f"{error}"
            ) from error

        for document in documents:

            if (
                "document_id"
                not in document.metadata
            ):

                document.metadata[
                    "document_id"
                ] = document_id

        retrieved_documents.extend(
            documents
        )

    if not retrieved_documents:
        return []

    first_retriever = next(
        iter(
            retrievers.values()
        )
    )

    final_k = getattr(
        first_retriever,
        "final_k",
        len(retrieved_documents)
    )

    return rerank_documents(
        query=query,
        documents=retrieved_documents,
        top_k=final_k
    )


def format_context(
    documents: list[Document]
) -> str:

    context_parts = []

    for index, document in enumerate(
        documents,
        start=1
    ):

        document_id = document.metadata.get(
            "document_id",
            "unknown"
        )

        source = document.metadata.get(
            "source",
            "unknown"
        )

        page = document.metadata.get(
            "page",
            "unknown"
        )

        relevance_score = document.metadata.get(
            "relevance_score"
        )

        relevance_text = ""

        if relevance_score is not None:

            relevance_text = (
                f", Relevance: "
                f"{relevance_score}"
            )

        context_parts.append(
            f"[Source {index}: "
            f"Document ID: {document_id}, "
            f"File: {source}, "
            f"Page: {page}"
            f"{relevance_text}]\n"
            f"{document.page_content}"
        )

    return "\n\n".join(
        context_parts
    )
