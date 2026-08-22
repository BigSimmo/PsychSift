function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function resolveLocalRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Only local JSON Schema references are supported: ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, segment) => value?.[segment], rootSchema);
}

function isDateTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validateNode(value, schema, rootSchema, path, errors) {
  if (schema.$ref) {
    const target = resolveLocalRef(rootSchema, schema.$ref);
    if (!target) {
      errors.push(`${path}: unresolved schema reference ${schema.$ref}`);
      return;
    }
    validateNode(value, target, rootSchema, path, errors);
    return;
  }

  if (schema.allOf) {
    for (const branch of schema.allOf) {
      validateNode(value, branch, rootSchema, path, errors);
    }
  }

  if (schema.oneOf) {
    const branchErrors = schema.oneOf.map((branch) => {
      const candidateErrors = [];
      validateNode(value, branch, rootSchema, path, candidateErrors);
      return candidateErrors;
    });
    const matches = branchErrors.filter((candidateErrors) => candidateErrors.length === 0).length;
    if (matches !== 1) errors.push(`${path}: expected exactly one oneOf branch, matched ${matches}`);
  }

  if (Object.hasOwn(schema, "const") && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}`);
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = valueType(value);
    if (!allowed.includes(actual)) {
      errors.push(`${path}: expected type ${allowed.join("|")}, received ${actual}`);
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path}: must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === "date-time" && !isDateTime(value)) errors.push(`${path}: must be an ISO date-time`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path}: must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.items)
      value.forEach((item, index) => validateNode(item, schema.items, rootSchema, `${path}[${index}]`, errors));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}: missing required property ${required}`);
    }
    const declared = new Set(Object.keys(schema.properties ?? {}));
    if (schema.additionalProperties === false) {
      for (const property of Object.keys(value)) {
        if (!declared.has(property)) errors.push(`${path}: additional property ${property} is not allowed`);
      }
    }
    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, property)) {
        validateNode(value[property], propertySchema, rootSchema, `${path}.${property}`, errors);
      }
    }
  }
}

export function validateJsonSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors);
  return errors;
}
