import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import ts from 'typescript';

// Use the parser shipped with the installed Commerce SDK (SDK 2.0.0 depends on yaml ^2.8.1).
const sdkRequire = createRequire(resolve('node_modules/@adobe/aio-commerce-lib-app/package.json'));
const YAML = sdkRequire('yaml');
const read = (path) => readFileSync(path, 'utf8');
const property = (node, key) => node?.properties?.find((p) => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.getText()) === key)?.initializer;
const text = (node) => node && ts.isStringLiteral(node) ? node.text : undefined;
const members = (node) => node && ts.isArrayLiteralExpression(node) ? node.elements : [];

function validateYaml() {
  for (const path of ['.github/workflows/pr_test.yml', '.github/workflows/deploy_stage.yml', '.github/workflows/deploy_prod.yml', 'app.config.yaml', 'install.yaml', 'src/commerce-extensibility-1/ext.config.yaml', 'src/commerce-configuration-1/ext.config.yaml', 'src/commerce-backend-ui-2/ext.config.yaml']) {
    if (!existsSync(path)) continue;
    const doc = YAML.parseDocument(read(path), { uniqueKeys: true });
    if (doc.errors.length) throw new Error(`Invalid YAML: ${path}`);
    if (path.startsWith('.github/') && (!doc.toJS().on || !doc.toJS().jobs || read(path).includes('pull_request_target'))) throw new Error(`Invalid workflow structure or unsafe trigger: ${path}`);
  }
  console.log('Workflow and app YAML parsed without duplicate keys.');
}

function verifyGenerated() {
  const source = ts.createSourceFile('app.commerce.config.ts', read('app.commerce.config.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error('Invalid authored TypeScript configuration');
  const declaration = source.statements.find((s) => ts.isExportAssignment(s));
  const config = declaration?.expression?.arguments?.[0];
  if (!config || !ts.isObjectLiteralExpression(config)) throw new Error('Expected defineConfig object');
  const manifest = JSON.parse(read('src/commerce-extensibility-1/.generated/app.commerce.manifest.json'));
  const metadata = property(config, 'metadata');
  for (const p of metadata?.properties ?? []) {
    if (!ts.isPropertyAssignment(p)) continue;
    const name = p.name.text;
    if (text(p.initializer) !== undefined && manifest.metadata?.[name] !== text(p.initializer)) throw new Error(`Generated metadata differs: ${name}`);
  }
  const businessConfig = property(config, 'businessConfig');
  for (const field of members(property(businessConfig, 'schema'))) {
    const name = text(property(field, 'name'));
    const generated = manifest.businessConfig?.schema?.find((item) => item.name === name);
    if (!name || !generated || generated.type !== text(property(field, 'type')) || generated.default !== text(property(field, 'default'))) throw new Error(`Generated business config differs: ${name ?? 'unknown'}`);
  }
  const eventing = property(config, 'eventing');
  for (const group of members(property(eventing, 'commerce'))) {
    for (const event of members(property(group, 'events'))) {
      const name = text(property(event, 'name'));
      const generated = manifest.eventing?.commerce?.flatMap((item) => item.events)?.find((item) => item.name === name);
      const fields = members(property(event, 'fields')).map((field) => text(property(field, 'name')));
      const actions = members(property(event, 'runtimeActions')).map(text);
      if (!name || !generated || JSON.stringify(generated.fields?.map((field) => field.name)) !== JSON.stringify(fields) || JSON.stringify(generated.runtimeActions) !== JSON.stringify(actions)) throw new Error(`Generated event differs: ${name ?? 'unknown'}`);
    }
  }
  const configMenu = property(property(config, 'adminUi'), 'menu');
  if (configMenu && manifest.adminUi?.menu?.id !== text(property(configMenu, 'id'))) throw new Error('Generated Admin menu differs');
  if (property(config, 'installation') && !manifest.installation) throw new Error('Generated installation missing');
  if (existsSync('app.commerce.manifest.json') && JSON.stringify(JSON.parse(read('app.commerce.manifest.json'))) !== JSON.stringify(manifest)) throw new Error('Root and extension manifests differ');
  for (const path of ['src/commerce-extensibility-1/.generated/actions/app-management/app-config.js', 'src/commerce-extensibility-1/.generated/actions/app-management/installation.js', 'src/commerce-extensibility-1/.generated/app.commerce.config.js', 'src/commerce-configuration-1/.generated/configuration-schema.json']) {
    if (!existsSync(path)) throw new Error(`Missing generated artifact: ${path}`);
  }
  console.log('Generated App Management metadata, event fields, settings, menu and installation agree with authored config.');
}

function scanSecrets() {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /(?:CLIENTSECRET|AIO_RUNTIME_AUTH|AIO_COMMERCE_CONFIG_ENCRYPTION_KEY)\s*[:=]\s*["']?(?!\$\{|\$[A-Z_])[A-Za-z0-9+/=_-]{24,}/i,
    /(?:ghp_|github_pat_|sk_live_|sk_test_)[A-Za-z0-9_]{20,}/,
  ];
  const paths = ['.github', 'scripts', 'src', 'app.commerce.config.ts', 'app.config.yaml', 'install.yaml', 'package.json'];
  function visit(path) {
    if (!existsSync(path)) return;
    if (/(^|\/)(?:\.env(?:\..*)?|\.aio|workspace\.json)(?:\/|$)/i.test(path)) throw new Error(`Sensitive path present: ${path}`);
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) if (name !== 'node_modules' && name !== 'dist') visit(join(path, name));
    } else if (!/\.(?:png|jpe?g|gif|webp|ico|woff2?|pdf|map)$/i.test(path)) {
      if (patterns.some((pattern) => pattern.test(read(path)))) throw new Error(`Possible credential in file: ${path}`);
    }
  }
  for (const path of paths) visit(path);
  console.log('Source passed credential-pattern and sensitive-path scanning.');
}

if (process.argv[2] === 'yaml') validateYaml();
else if (process.argv[2] === 'generated') verifyGenerated();
else if (process.argv[2] === 'secrets') scanSecrets();
else throw new Error('Expected yaml, generated or secrets');
