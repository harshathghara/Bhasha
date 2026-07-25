import os

from dotenv import load_dotenv

from .api import create_app
from .llm_client import OpenAILLMClient
from .store import ShowStore

load_dotenv()

store = ShowStore(snapshot_dir="snapshots")
llm_client = OpenAILLMClient(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
app = create_app(store, llm_client)
