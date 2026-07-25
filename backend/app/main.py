from .api import create_app
from .llm_client import OpenAILLMClient
from .store import ShowStore

store = ShowStore(snapshot_dir="snapshots")
llm_client = OpenAILLMClient()
app = create_app(store, llm_client)
