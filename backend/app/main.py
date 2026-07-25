from dotenv import load_dotenv

from .api import create_app
from .llm_client import LLMClient
from .llm_config import resolve_llm_settings
from .store import ShowStore

load_dotenv()

store = ShowStore(snapshot_dir="snapshots")
settings = resolve_llm_settings()
llm_client = LLMClient(
    model=settings["model"],
    api_key=settings["api_key"],
    base_url=settings["base_url"],
)
app = create_app(store, llm_client)
