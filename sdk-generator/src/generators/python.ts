/**
 * Python SDK generator — emits a `requests`-based client module.
 */
import type { SdkSpec, GeneratedFile, GeneratedSdk, SdkOperation } from '../lib/sdk-types.js';

export function generatePythonSdk(spec: SdkSpec): GeneratedSdk {
  const files: GeneratedFile[] = [
    { path: 'setup.py', content: renderSetupPy(spec) },
    { path: 'pyproject.toml', content: renderPyProject(spec) },
    { path: `${toPackageName(spec.packageName)}/__init__.py`, content: renderInit(spec) },
    { path: `${toPackageName(spec.packageName)}/client.py`, content: renderClient(spec) },
    { path: 'README.md', content: renderReadme(spec) },
  ];
  return {
    language: 'python',
    packageName: spec.packageName,
    version: spec.version,
    files,
  };
}

function toPackageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function renderSetupPy(spec: SdkSpec): string {
  return `from setuptools import setup, find_packages

setup(
    name='${spec.packageName}',
    version='${spec.version}',
    packages=find_packages(),
    install_requires=['requests>=2.28.0'],
    python_requires='>=3.8',
)
`;
}

function renderPyProject(spec: SdkSpec): string {
  return `[project]
name = "${spec.packageName}"
version = "${spec.version}"
description = "Auto-generated Python SDK for ${spec.packageName}"
requires-python = ">=3.8"
dependencies = ["requests>=2.28.0"]
`;
}

function renderInit(spec: SdkSpec): string {
  return `from .client import ApiClient, ApiError

__version__ = '${spec.version}'
__all__ = ['ApiClient', 'ApiError']
`;
}

function renderClient(spec: SdkSpec): string {
  const methods = spec.operations.map((op) => renderMethod(op)).join('\n\n');

  return `"""
${spec.packageName} — auto-generated Python SDK
Version: ${spec.version}
Base URL: ${spec.baseUrl}
"""

from typing import Any, Dict, Optional
import requests


class ApiError(Exception):
    def __init__(self, status: int, body: str, method: str, url: str):
        super().__init__(f"{method} {url} failed with {status}: {body}")
        self.status = status
        self.body = body


class ApiClient:
    def __init__(
        self,
        base_url: str = "${spec.baseUrl}",
        bearer_token: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.api_key = api_key
        self.timeout = timeout
        self.session = requests.Session()

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    def _request(
        self,
        method: str,
        path: str,
        path_params: Optional[Dict[str, Any]] = None,
        query_params: Optional[Dict[str, Any]] = None,
        body: Any = None,
    ) -> Any:
        url = self.base_url + path
        if path_params:
            for key, value in path_params.items():
                url = url.replace("{" + key + "}", str(value))

        response = self.session.request(
            method,
            url,
            headers=self._headers(),
            params={k: v for k, v in (query_params or {}).items() if v is not None},
            json=body,
            timeout=self.timeout,
        )

        if not response.ok:
            raise ApiError(response.status_code, response.text, method, url)

        content_type = response.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return response.json()
        return response.text

${methods}
`;
}

function renderMethod(op: SdkOperation): string {
  const methodName = toSnakeCase(op.operationId);
  const args: string[] = ['self'];
  const pathParamsDict: string[] = [];

  for (const p of op.pathParams) {
    args.push(`${toSnakeCase(p)}: Any`);
    pathParamsDict.push(`"${p}": ${toSnakeCase(p)}`);
  }

  if (op.bodyType) args.push('body: Optional[Dict[str, Any]] = None');
  args.push('query: Optional[Dict[str, Any]] = None');

  const pathParamsArg = pathParamsDict.length > 0
    ? `{${pathParamsDict.join(', ')}}`
    : 'None';

  const bodyArg = op.bodyType ? 'body' : 'None';

  return `    def ${methodName}(${args.join(', ')}) -> Any:
        """${op.summary || methodName}"""
        return self._request(
            "${op.method}",
            "${op.path}",
            path_params=${pathParamsArg},
            query_params=query,
            body=${bodyArg},
        )`;
}

function renderReadme(spec: SdkSpec): string {
  const firstOp = spec.operations[0];
  const example = firstOp ? toSnakeCase(firstOp.operationId) + '()' : 'some_operation()';
  return `# ${spec.packageName}

Auto-generated Python SDK for ${spec.packageName}, version ${spec.version}.

## Installation

\`\`\`bash
pip install ${spec.packageName}
\`\`\`

## Usage

\`\`\`python
from ${toPackageName(spec.packageName)} import ApiClient

client = ApiClient(
    base_url="${spec.baseUrl}",
    bearer_token="your-token",
)

result = client.${example}
\`\`\`

## Operations

${spec.operations.map((op) => `- \`${toSnakeCase(op.operationId)}\` — ${op.method} ${op.path}${op.summary ? ` — ${op.summary}` : ''}`).join('\n')}
`;
}
