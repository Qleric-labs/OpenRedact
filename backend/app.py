import os
import traceback
import spacy
import fitz  # PyMuPDF
import re
import json
import io

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
UPLOAD_FOLDER = "uploads"
ALLOWED_EXTENSIONS = {"pdf"}
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# Create upload directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- spaCy Model and Deny-List Initialization ---

nlp = None
# Expanded, case-insensitive deny list
DENY_LIST = {
    # Original terms
    "licensee", "licensor", "party", "parties", "agreement", "effective date", 
    "content", "software", "f-1", "censoring", "maintenance", 
    "governmental authority", "law", "laws", "appendix", "exhibit",
    "person", "persons", "affiliate", "affiliates",

    # New terms from user feedback
    "licensed content", "licensee's affiliates", "e-house", "the share purchase agreement",
    "advertising sale agency agreement", "content license agreement", "the effective date",
    "the licensed domain names", "the agency agreement", "operating content", "e-house research",
    "training institute", "licensee control", "content distribution", "licensee obligations",
    "confidential information", "dispute", "commission", "claimant", "respondent",
    "warranties", "entire agreement", "public announcements", "legal department",
    "the securities exchange act", "termination of original agreement", "the mutual termination agreement"
}

try:
    print("Initializing spaCy model...")
    nlp = spacy.load("en_core_web_sm")
    print("spaCy model initialized successfully.")
except Exception as e:
    print(f"FATAL: Could not initialize spaCy model. {e}")


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({"status": "healthy", "message": "Redaction API is running"})

@app.route("/api/analyze-contract", methods=["POST"])
def analyze_contract():
    """Main endpoint for PII redaction analysis"""
    if not nlp:
        return jsonify(
            {"error": "PII detection model is not available due to an initialization error."}
        ), 503

    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        filename = secure_filename(file.filename)

        if filename == "" or not allowed_file(filename):
            return jsonify({"error": "Invalid or no file selected (PDFs only)"}), 400

        file_content = file.read()
        file_size = len(file_content)

        if file_size == 0:
            return jsonify({"error": "Empty file provided"}), 400

        # --- PII Redaction Logic ---
        doc = fitz.open(stream=file_content, filetype="pdf")
        full_text = ""
        redactions = []
        page_offsets = []  # CORRECT: Initialize list
        
        for page_num, page in enumerate(doc):
            page_offsets.append(len(full_text)) # CORRECT: Record start index of page text
            page_text = page.get_text("text")
            text_offset = len(full_text)
            full_text += page_text + "\n"

            # 1. spaCy NER for entities
            spacy_doc = nlp(page_text)
            for ent in spacy_doc.ents:
                if ent.text.strip().lower() in DENY_LIST:
                    continue

                entity_type = ent.label_
                if entity_type in ["GPE", "LOC"]:
                    entity_type = "LOCATION"

                if entity_type in ["PERSON", "ORG", "LOCATION"]:
                    redactions.append({
                        "text": ent.text,
                        "start": ent.start_char + text_offset,
                        "end": ent.end_char + text_offset,
                        "type": entity_type,
                        "page": page_num + 1,
                    })

            # 2. Regex for emails and phones
            for match in re.finditer(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', page_text):
                redactions.append({
                    "text": match.group(0),
                    "start": match.start() + text_offset,
                    "end": match.end() + text_offset,
                    "type": "EMAIL",
                    "page": page_num + 1,
                })
            
            for match in re.finditer(r'(\d{3}[- .]?){2}\d{4}', page_text):
                redactions.append({
                    "text": match.group(0),
                    "start": match.start() + text_offset,
                    "end": match.end() + text_offset,
                    "type": "PHONE",
                    "page": page_num + 1,
                })

        results = {
            "filename": filename,
            "file_size": file_size,
            "full_text": full_text,
            "redactions": redactions,
            "page_offsets": page_offsets,
            "extraction_timestamp": "2025-10-15T12:00:00Z", # Placeholder
            "contract_type": "redaction_analysis" # Placeholder
        }

        return jsonify(results)

    except Exception as e:
        print(f"Error processing contract: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route("/api/generate-redacted-pdf", methods=["POST"])
def generate_redacted_pdf():
    """Generates a new PDF with the specified redactions applied."""
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        if "redactions" not in request.form:
            return jsonify({"error": "No redaction data provided"}), 400

        file = request.files["file"]
        redactions_data = json.loads(request.form["redactions"])
        
        file_content = file.read()
        doc = fitz.open(stream=file_content, filetype="pdf")

        # Group redactions by page for efficient processing
        redactions_by_page = {}
        for r in redactions_data:
            page_num = r.get("page")
            if page_num is not None:
                if page_num not in redactions_by_page:
                    redactions_by_page[page_num] = []
                redactions_by_page[page_num].append(r["text"])

        # Apply redactions page by page
        for page_num, texts_to_redact in redactions_by_page.items():
            if page_num > 0 and page_num <= len(doc):
                page = doc[page_num - 1]
                for text in texts_to_redact:
                    areas = page.search_for(text)
                    for area in areas:
                        page.add_redact_annot(area, fill=(0, 0, 0)) # Black fill
                page.apply_redactions()

        # Save the redacted PDF to a memory buffer
        output_buffer = io.BytesIO()
        doc.save(output_buffer)
        output_buffer.seek(0)
        doc.close()

        return send_file(
            output_buffer,
            as_attachment=True,
            download_name=f"redacted_{file.filename}",
            mimetype="application/pdf"
        )

    except Exception as e:
        print(f"Error generating redacted PDF: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route("/api/test", methods=["GET"])
def test_endpoint():
    return jsonify({"message": "Redaction API is working!", "spacy_loaded": nlp is not None})

if __name__ == "__main__":
    print("Starting Redaction API...")
    app.run(debug=True, host="0.0.0.0", port=5000)
