# Spec: Form-urlencoded Request Parsing + String Response Body

**Status**: Done

## Motivation

mock-loom needs to support APIs that don't use JSON, both in request and response. The concrete case is **SIGE** (sige.mineduc.cl), a Chilean government API for school enrollment management that:

- Sends all requests as `application/x-www-form-urlencoded`
- Returns responses in HTML (student roster tables), XML (identity validation against Civil Registry), and `;`-delimited text (report exports)

This is common in government systems, ERPs, and other legacy integrations. Without these capabilities, mock-loom cannot mock this type of API.

---

## 1. Parsing request body `application/x-www-form-urlencoded`

### Previous behavior

`request.body` was only parsed as JSON. When the Content-Type was `application/x-www-form-urlencoded`, the body remained a raw string. Scenarios could not access individual form fields.

### Expected behavior

When `Content-Type` is `application/x-www-form-urlencoded`, `request.body` must be a map with form fields as keys and their values as strings.

**Example:**

Request body: `accion=buscarAlumno&txtRun=26075524&txtSexo=M`

```
request.body.accion   → "buscarAlumno"
request.body.txtRun   → "26075524"
request.body.txtSexo  → "M"
```

This enables scenario conditions like:

```
request.body.accion == "buscarAlumno" && request.body.txtRun == "26075524"
```

### Rules

- Fields with a single value: `request.body.field` → `"value"` (string)
- Fields with multiple values (`foo=1&foo=2`): use the first value
- Fields with no value (`foo=`): `request.body.foo` → `""` (empty string)
- If Content-Type is not form-urlencoded, maintain current behavior (parse as JSON or leave as raw string)

---

## 2. String response body type

### Previous behavior

`response.body` in scenarios only accepted JSON objects (`{}`). Strings, arrays, numbers, and null were rejected by validation.

### Expected behavior

`response.body` accepts **string** in addition to JSON object. When it is a string, it is sent as raw bytes to the client. The response Content-Type is controlled via `response.headers`.

**Example — HTML response:**

```json
{
  "response": {
    "statusCode": 200,
    "headers": { "Content-Type": "text/html; charset=utf-8" },
    "body": "<html><body><table id=\"tablaSort\"><tr><td>26075524</td><td>JUAN PEREZ GARCIA</td></tr></table></body></html>"
  }
}
```

**Example — XML response:**

```json
{
  "response": {
    "statusCode": 200,
    "headers": { "Content-Type": "application/xml; charset=utf-8" },
    "body": "<rc><codigo>OK</codigo><glosa>Consulta exitosa</glosa><rut>26075524-3</rut><nombres>JUAN</nombres><paterno>PEREZ</paterno><materno>GARCIA</materno><sexo>M</sexo></rc>"
  }
}
```

**Example — delimited text response:**

```json
{
  "response": {
    "statusCode": 200,
    "headers": { "Content-Type": "text/plain; charset=iso-8859-1" },
    "body": "2026;9907;110;3;3ro Basico;A;26075524;3;M;JUAN;PEREZ;GARCIA;CALLE FALSA 123;13;SANTIAGO;13101;;+56912345678;;15/03/2015;0;01/03/2026;;6.2;92"
  }
}
```

### Rules

- `body` is JSON object → serialized as JSON with `application/json` (current behavior, no change)
- `body` is string → sent as raw bytes. Default Content-Type is `text/plain; charset=utf-8`, overridden if `response.headers` defines `Content-Type`
- `body` is null/omitted → no body (current behavior)

---

## Compatibility

Both changes are backwards-compatible:

- Requests with `Content-Type: application/json` continue to be parsed as JSON
- Existing scenarios with `response.body` as JSON object continue to work identically
- No modifications to MCP interfaces or HTTP API
