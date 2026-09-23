from fastapi import FastAPI

app = FastAPI(title="SKYNET")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
