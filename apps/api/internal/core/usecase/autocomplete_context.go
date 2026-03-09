package usecase

import (
	"encoding/json"
	"sort"
	"strings"
)

func extractRequestPaths(contractJSON string) []string {
	paths := append([]string{}, defaultRequestPaths()...)
	root, ok := decodeJSONObject(contractJSON)
	if !ok {
		return uniqueSortedStrings(withRequestParamsAliases(paths))
	}

	properties, hasProperties := root["properties"].(map[string]any)
	if !hasProperties {
		const requestBodyPrefix = "request.body"
		paths = append(paths, requestBodyPrefix)
		collectSchemaPaths(root, requestBodyPrefix, &paths)
		return uniqueSortedStrings(withRequestParamsAliases(paths))
	}

	if body, ok := properties["body"].(map[string]any); ok {
		paths = append(paths, "request.body")
		collectSchemaPaths(body, "request.body", &paths)
	}
	if query, ok := properties["query"].(map[string]any); ok {
		paths = append(paths, "request.query")
		collectSchemaPaths(query, "request.query", &paths)
	}
	if header, ok := properties["header"].(map[string]any); ok {
		paths = append(paths, "request.header")
		collectSchemaPaths(header, "request.header", &paths)
	}
	if headers, ok := properties["headers"].(map[string]any); ok {
		paths = append(paths, "request.header")
		collectSchemaPaths(headers, "request.header", &paths)
	}

	for key, raw := range properties {
		if key == "body" || key == "query" || key == "header" || key == "headers" {
			continue
		}
		child, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		path := "request.body." + key
		paths = append(paths, path)
		collectSchemaPaths(child, path, &paths)
	}

	return uniqueSortedStrings(withRequestParamsAliases(paths))
}

func extractSourcePaths(sourceSlug string, schemaJSON string) []string {
	slug := strings.TrimSpace(sourceSlug)
	if slug == "" {
		return []string{}
	}

	rootPath := "source." + slug
	paths := []string{rootPath}
	root, ok := decodeJSONObject(schemaJSON)
	if !ok {
		return uniqueSortedStrings(paths)
	}

	collectSchemaPaths(root, rootPath, &paths)
	return uniqueSortedStrings(paths)
}

func collectSchemaPaths(node map[string]any, prefix string, out *[]string) {
	properties, hasProperties := node["properties"].(map[string]any)
	if hasProperties {
		keys := make([]string, 0, len(properties))
		for key := range properties {
			keys = append(keys, key)
		}
		sort.Strings(keys)

		for _, key := range keys {
			childPath := prefix + "." + key
			*out = append(*out, childPath)
			childObject, _ := properties[key].(map[string]any)
			if childObject != nil {
				collectSchemaPaths(childObject, childPath, out)
			}
		}
	}

	if items, ok := node["items"].(map[string]any); ok {
		arrayPath := prefix + "[]"
		*out = append(*out, arrayPath)
		collectSchemaPaths(items, arrayPath, out)
	}

	for _, variantKey := range []string{"allOf", "anyOf", "oneOf"} {
		raw, ok := node[variantKey].([]any)
		if !ok {
			continue
		}
		for _, item := range raw {
			if variant, ok := item.(map[string]any); ok {
				collectSchemaPaths(variant, prefix, out)
			}
		}
	}
}

func buildTemplatePaths(requestPaths []string, sourcePaths []string) []string {
	templates := make([]string, 0, len(requestPaths)+len(sourcePaths))
	for _, path := range requestPaths {
		templates = append(templates, "{{"+path+"}}")
	}
	for _, path := range sourcePaths {
		templates = append(templates, "{{"+path+"}}")
	}
	return uniqueSortedStrings(templates)
}

func defaultRequestPaths() []string {
	return []string{
		"request.method",
		"request.path",
		"request.header",
		"request.query",
		"request.body",
		"request.params",
		"request.params.path",
		"request.params.query",
		"request.params.headers",
		"request.params.body",
	}
}

func defaultAutocompleteFunctions() []string {
	return []string{
		"contains(field, value)",
		"startsWith(field, prefix)",
		"endsWith(field, suffix)",
		"field in [value1, value2]",
	}
}

func uniqueSortedStrings(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		set[trimmed] = struct{}{}
	}

	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func withRequestParamsAliases(paths []string) []string {
	aliases := make([]string, 0, len(paths))
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		aliases = append(aliases, trimmed)
		switch {
		case strings.HasPrefix(trimmed, "request.header"):
			aliases = append(aliases, "request.params.headers"+strings.TrimPrefix(trimmed, "request.header"))
		case strings.HasPrefix(trimmed, "request.query"):
			aliases = append(aliases, "request.params.query"+strings.TrimPrefix(trimmed, "request.query"))
		case strings.HasPrefix(trimmed, "request.body"):
			aliases = append(aliases, "request.params.body"+strings.TrimPrefix(trimmed, "request.body"))
		}
	}
	return aliases
}

func extractPathParamRequestPaths(pathTemplate string) []string {
	segments := splitPathSegments(normalizeRuntimePath(pathTemplate))
	paths := []string{"request.params.path"}
	for _, segment := range segments {
		name := pathTemplateParamName(segment)
		if name == "" {
			continue
		}
		paths = append(paths, "request.params.path."+name)
	}
	return uniqueSortedStrings(paths)
}

func decodeJSONObject(payload string) (map[string]any, bool) {
	trimmed := strings.TrimSpace(payload)
	if trimmed == "" {
		return nil, false
	}

	var parsed any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
		return nil, false
	}
	object, ok := parsed.(map[string]any)
	return object, ok
}
