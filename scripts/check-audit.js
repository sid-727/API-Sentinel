const fs = require('fs');

const path = process.argv[2] || 'audit.json';
if (!fs.existsSync(path)) {
  console.error('Audit file not found:', path);
  process.exit(1);
}

let json;
try {
  const buffer = fs.readFileSync(path);
  let content;
  
  // Detect UTF-16 BOMs (common in Windows PowerShell redirection)
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    content = buffer.toString('utf16le');
  } else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    content = buffer.toString('utf16be');
  } else {
    content = buffer.toString('utf8');
  }
  
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  
  json = JSON.parse(content);
} catch (err) {
  console.error('Failed to parse audit JSON:', err.message);
  process.exit(1);
}

const vuln = (json.metadata && json.metadata.vulnerabilities) || {};
const high = (vuln.high || 0);
const critical = (vuln.critical || 0);

// Log high vulnerabilities as warnings so they are visible but don't block deployments
if (high > 0) {
  console.warn(`\x1b[33mWarning: ${high} high-severity vulnerabilities found in dependencies. Please schedule remediation.\x1b[0m`);
  if (json.vulnerabilities) {
    Object.entries(json.vulnerabilities).forEach(([pkg, data]) => {
      if (data.severity === 'high') {
        console.warn(`- [${data.severity}] ${pkg}: ${data.via?.map(v => typeof v === 'object' ? v.title : v).join(', ') || 'Dependency threat'}`);
      }
    });
  }
}

// Fail the build only for critical vulnerabilities
if (critical > 0) {
  console.error(`\x1b[31mFailing CI: ${critical} critical vulnerabilities found in dependencies.\x1b[0m`);
  if (json.vulnerabilities) {
    Object.entries(json.vulnerabilities).forEach(([pkg, data]) => {
      if (data.severity === 'critical') {
        console.error(`- [${data.severity}] ${pkg}: ${data.via?.map(v => typeof v === 'object' ? v.title : v).join(', ') || 'Dependency threat'}`);
      }
    });
  } else if (json.advisories) {
    Object.values(json.advisories).forEach(a => {
      if (a.severity === 'critical') {
        console.error(`- [${a.severity}] ${a.module_name}@${a.findings?.[0]?.version || 'unknown'}: ${a.title}`);
      }
    });
  }
  process.exit(1);
}

console.log('\x1b[32mNo critical vulnerabilities found. Audit check passed.\x1b[0m');
process.exit(0);
