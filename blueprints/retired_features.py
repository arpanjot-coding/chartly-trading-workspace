"""Explicit compatibility responses for removed specialist screens and APIs."""
import json
from pathlib import Path

from flask import Blueprint, jsonify, redirect

retired_features_bp = Blueprint('retired_features', __name__)
_registry = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))


def retired_page():
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<title>Feature unavailable | Chartly</title>'
        '<h1>This feature is unavailable</h1>'
        '<p>Open Workspace to reach your charts, accounts, and journals.</p>'
        '<p><a href="/workspace">Open Workspace</a></p></html>',
        410,
    )


def retired_api(**_kwargs):
    return jsonify(status='error', message='This specialist feature has been retired.'), 410


@retired_features_bp.route('/tools')
def old_directory():
    return redirect('/workspace', code=302)


for index, path in enumerate(_registry['pages']):
    retired_features_bp.add_url_rule(path, f'page_{index}', retired_page, strict_slashes=False)

for index, path in enumerate(sorted(set(_registry['apiRoutes']))):
    retired_features_bp.add_url_rule(path, f'api_{index}', retired_api, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], strict_slashes=False)

retired_features_bp.add_url_rule('/api/v1/sip', 'sip_root', retired_api, methods=['GET', 'POST'])
retired_features_bp.add_url_rule('/api/v1/sip/<path:rest>', 'sip', retired_api, methods=['GET', 'POST'])
