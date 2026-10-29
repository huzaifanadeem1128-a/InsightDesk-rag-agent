import io
import os
import uuid
import hashlib
from typing import Iterable

from pypdf import PdfReader

from langchain_core.documents import Document
from langchain_text_splitters import (
    RecursiveCharacterTextSplitter
)
from langchain_chroma import Chroma

from services.retrieval import RetrievalWrapper

MAX_CANDIDATE_K = 25  # generous upper bound; final_k applied later, live

def load_uploaded_documents(
    uploaded_files: Iterable
) -> list[Document]:

    documents = []

    for uploaded_file in uploaded_files:

        name = uploaded_file.name
        data = uploaded_file.getvalue()
        extension = os.path.splitext(name)[1].lower()
        content_hash = hashlib.sha256(data).hexdigest()
        document_id = f"doc_{uuid.uuid4().hex}"

        try:

            if extension == ".pdf":

                reader = PdfReader(
                    io.BytesIO(data)
                )

                for page_number, page in enumerate(
                    reader.pages,
                    start=1
                ):

                    text = page.extract_text() or ""

                    if text.strip():

                        documents.append(
                            Document(
                                page_content=text,
                                metadata={
                                    "document_id": document_id,
                                    "source": name,
                                    "page": page_number,
                                    "content_hash": content_hash,
                                },
                            )
                        )

            elif extension == ".txt":

                text = data.decode("utf-8")

                if text.strip():

                    documents.append(
                        Document(
                            page_content=text,
                            metadata={
                                "document_id": document_id,
                                "source": name,
                                "page": 1,
                                "content_hash": content_hash,
                            },
                        )
                    )

            else:

                raise ValueError(
                    f"Unsupported file type: {extension}"
                )

        except ValueError:
            raise

        except Exception as error:

            raise RuntimeError(
                f"Failed to process document "
                f"'{name}': {error}"
            ) from error

    if not documents:

        raise ValueError(
            "No documents found in the uploaded files"
        )

    return documents


def build_document_index(
    uploaded_files: Iterable,
    embedding_model,
    chunk_size: int,
    chunk_overlap: int,
    top_k: int
) -> dict:

    documents = load_uploaded_documents(
        uploaded_files
    )

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=True,
    )

    chunks = splitter.split_documents(
        documents
    )

    if not chunks:

        raise ValueError(
            "No document chunks were created"
        )

    vector_stores = {}
    retrievers = {}
    chunks_by_document = {}

    for chunk in chunks:

        document_id = chunk.metadata.get(
            "document_id",
            "unknown"
        )

        chunks_by_document.setdefault(
            document_id,
            []
        ).append(chunk)


    collection_names = {}

    for document_id, document_chunks in (
        chunks_by_document.items()
    ):

        collection_name = (
            f"rag_{uuid.uuid4().hex}"
        )

        try:

            vector_store = Chroma(
                collection_name=collection_name,
                embedding_function=embedding_model,
                persist_directory="./chroma_db",
                collection_metadata={"hnsw:space": "cosine"},
            )

            vector_store.add_documents(
                document_chunks
            )

        except Exception as error:

            raise RuntimeError(
                "Failed to create the Chroma "
                f"index for document "
                f"'{document_id}': {error}"
            ) from error

        vector_stores[document_id] = (
            vector_store
        )

        collection_names[document_id] = (
            collection_name
        )

        candidate_k = max(
            MAX_CANDIDATE_K,
            len(document_chunks)
        )

        base_retriever = (
            vector_store.as_retriever(
                search_type="similarity",
                search_kwargs={
                    "k": min(candidate_k, len(document_chunks))
                },
            )
        )

        retrievers[document_id] = (
            RetrievalWrapper(
                retriever=base_retriever,
                final_k=top_k,
                vector_store=vector_store,
            )
        )

    try:

        embedding_dimension = len(
            embedding_model.embed_query(
                "dimension check"
            )
        )

    except Exception as error:

        raise RuntimeError(
            "Failed to calculate the "
            f"embedding dimension: {error}"
        ) from error

    document_map = {}
    content_hashes = {}

    for document in documents:

        document_id = document.metadata.get(
            "document_id"
        )

        source = document.metadata.get(
            "source",
            "unknown"
        )
        
        content_hash = document.metadata.get(
            "content_hash"
        )

        if document_id:

            document_map[document_id] = source
            content_hashes[document_id] = content_hash

    return {
        "documents": documents,
        "chunks": chunks,
        "vector_stores": vector_stores,
        "retrievers": retrievers,
        "embedding_dimension": embedding_dimension,
        "document_ids": list(
            retrievers.keys()
        ),
        "document_map": document_map,
        "collection_names": collection_names,
        "content_hashes": content_hashes,
    }
