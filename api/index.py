import sys
import os

# Add backend/ to path so `from app.xxx import ...` works in Vercel serverless
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.main import app
