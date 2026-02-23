from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from api.routes import router

app = FastAPI(
    title="Solvere Engine",
    description="Seaduste täitmise kontrollimise platvorm",
    version="2.0.0"
)

app.include_router(router, prefix="/api")


@app.get("/", response_class=HTMLResponse)
def serve_ui():
    try:
        with open("index.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>Solvere Engine töötab</h1>"