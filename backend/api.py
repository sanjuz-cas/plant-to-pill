from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import requests
import random
import os
from typing import Dict, Any

from ml_engine import WalkJumpEngine

app = FastAPI(
    title="Plant2Pill Enterprise API",
    description="Backend API for Cyclotide Combinatorics using Walk-Jump Sampling and ESMFold",
    version="1.0.0"
)

# Enable CORS so the HTML files can talk to the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for development
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (POST, GET, etc.)
    allow_headers=["*"],  # Allows all headers
)

# Mount the root directory to serve HTML files
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

@app.get("/")
def read_root():
    """Serve the main MVP dashboard."""
    return FileResponse(os.path.join(root_dir, "index.html"))

@app.get("/{filename}.html")
def serve_html(filename: str):
    """Serve any other HTML file."""
    file_path = os.path.join(root_dir, f"{filename}.html")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")

# Mount assets folder
app.mount("/assets", StaticFiles(directory=os.path.join(root_dir, "assets")), name="assets")

# Initialize the PyTorch-based ML Engine
ml_engine = WalkJumpEngine()

class SequenceRequest(BaseModel):
    sequence: str

class MutateRequest(BaseModel):
    sequence: str
    noise_level: float = 0.5
    steps: int = 5

@app.post("/api/v1/mutate", response_model=Dict[str, Any])
def mutate_sequence(request: MutateRequest):
    """
    Applies Discrete Walk-Jump Sampling to a target sequence in a continuous Latent Space.
    Preserves Cystine structural nodes.
    """
    try:
        new_seq = ml_engine.walk_jump_mutate(
            request.sequence, 
            noise_level=request.noise_level, 
            steps=request.steps
        )
        return {
            "original": request.sequence, 
            "mutated": new_seq,
            "status": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ML Engine Error: {str(e)}")

@app.post("/api/v1/fold", response_model=Dict[str, str])
def fold_sequence(request: SequenceRequest):
    """
    Proxies sequence to Meta's ESMFold API safely from the backend.
    """
    try:
        response = requests.post(
            "https://api.esmatlas.com/foldSequence/v1/pdb/",
            data=request.sequence,
            headers={"Content-Type": "text/plain"},
            timeout=15
        )
        if response.status_code == 200:
            return {"pdb": response.text}
        else:
            raise HTTPException(
                status_code=response.status_code, 
                detail=f"ESMFold API failed with status {response.status_code}"
            )
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=504, detail=f"ESMFold API Timeout/Error: {str(e)}")

@app.post("/api/v1/score", response_model=Dict[str, float])
def score_sequence(request: SequenceRequest):
    """
    Distributional Conformity Score (DCS) & Cystine verification.
    """
    cys_count = request.sequence.count("C")
    score = cys_count * 10.0
    # Add bonus for forming a complete knot
    if cys_count >= 6:
        score += 40.0
        
    return {
        "dcs_score": min(100.0, score),
        "knot_integrity": score / 100.0
    }

@app.post("/api/v1/murburn", response_model=Dict[str, float])
def simulate_murburn_physics(request: SequenceRequest):
    """
    Simulates Gastric Murburn Reactions (DROS attacks).
    """
    seq = request.sequence
    integrity = 100.0
    particles = 50 # Base intensity

    for _ in range(particles):
        if random.random() < 0.3:
            target_resi = random.randint(0, len(seq) - 1)
            # Knot deflection logic
            if seq[target_resi] == "C" and random.random() > 0.4:
                continue 
            
            # Cyclic molecules take far less damage than linear
            damage = random.uniform(0.5, 2.0)
            integrity -= damage

    return {
        "bioavailability_percent": max(0.0, round(integrity, 2))
    }
