import json
import os

from openai import OpenAI


class LLMClient:
    def __init__(
        self,
        model: str = "gpt-4o-mini",
        api_key: str = None,
        base_url: str = None,
    ):
        self.model = model
        kwargs = {"api_key": api_key or os.environ["OPENAI_API_KEY"]}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content or ""

    def complete_with_tools(self, system_prompt: str, user_prompt: str,
                            tools: list) -> list:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            tools=tools,
        )
        message = response.choices[0].message
        calls = []
        for tool_call in message.tool_calls or []:
            try:
                arguments = json.loads(tool_call.function.arguments)
            except (json.JSONDecodeError, TypeError):
                continue
            calls.append({"name": tool_call.function.name, "arguments": arguments})
        return calls


OpenAILLMClient = LLMClient
