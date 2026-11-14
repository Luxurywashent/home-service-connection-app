import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const PROJECT_NAME = '@lilmerge4/home-service-connection';
export const PROJECT_ID = 'e6614385-618a-460d-a650-06ae63b97563';
export const SOURCE_PACKAGE = 'com.homeserviceconnection.mobile';
export const TARGET_PACKAGE = 'com.homeserviceconnected';
export const EXPECTED_SHA1 = '71:88:8D:3D:CA:A5:A7:6A:3D:D0:B9:46:54:B4:16:9C:55:65:28:13';
const REJECTED_SHA1 = '7E:0F:14:AC:AD:92:24:4D:AC:D2:AC:F0:31:3B:52:7C:08:10:58:82';

// Same query/mutation contracts as EAS CLI, with ONLY public metadata fields.
export const QUERY = `query AndroidUploadKeyMetadata($projectFullName: String!, $applicationIdentifier: String!) {
  app { byFullName(fullName: $projectFullName) {
    id
    androidAppCredentials(filter: {applicationIdentifier: $applicationIdentifier, legacyOnly: false}) {
      id applicationIdentifier
      androidAppBuildCredentialsList {
        id name isDefault
        androidKeystore { id sha1CertificateFingerprint }
      }
    }
  } }
}`;
export const MUTATION = `mutation ReuseVerifiedAndroidUploadKey($credentialId: ID!, $keystoreId: ID!) {
  androidAppBuildCredentials {
    setKeystore(id: $credentialId, keystoreId: $keystoreId) {
      id androidKeystore { id sha1CertificateFingerprint }
    }
  }
}`;

export function normalizeFingerprint(value) {
  return String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}
const matches = (key, sha1) => normalizeFingerprint(key?.sha1CertificateFingerprint) === normalizeFingerprint(sha1);

async function graphql(query, variables, token) {
  assert(token, 'EXPO_TOKEN is required');
  const response = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `Expo credential API HTTP ${response.status}`);
  const result = await response.json();
  assert(!result.errors?.length, result.errors?.map(error => error.message).join('; '));
  assert(result.data, 'Expo credential response has no data');
  return result.data;
}

export async function verifyAndroidUploadKey({ token, reuseOriginal = false, request = graphql }) {
  async function read(packageName) {
    const data = await request(QUERY, { projectFullName: PROJECT_NAME, applicationIdentifier: packageName }, token);
    const app = data.app?.byFullName;
    assert(app?.id === PROJECT_ID, 'Unexpected Expo project: no signing changes permitted');
    const entries = app.androidAppCredentials || [];
    assert(entries.length === 1 && entries[0].applicationIdentifier === packageName, 'Unexpected Android credential identifier');
    const defaults = entries[0].androidAppBuildCredentialsList.filter(item => item.isDefault);
    assert(defaults.length === 1, 'Expected exactly one existing default build credential');
    assert(defaults[0].androidKeystore?.id, 'No existing upload key; automatic generation is forbidden');
    return defaults[0];
  }
  const source = await read(SOURCE_PACKAGE);
  assert(matches(source.androidKeystore, EXPECTED_SHA1), 'Original key does not match Google Play; no assignment performed');
  let target = await read(TARGET_PACKAGE);
  let reassigned = false;
  if (!matches(target.androidKeystore, EXPECTED_SHA1)) {
    assert(reuseOriginal, 'Android upload certificate does not match Google Play; reuse the verified original key before building');
    assert(matches(target.androidKeystore, REJECTED_SHA1), 'Target certificate changed unexpectedly; no assignment performed');
    const changed = await request(MUTATION, { credentialId: target.id, keystoreId: source.androidKeystore.id }, token);
    assert(changed.androidAppBuildCredentials?.setKeystore?.id === target.id, 'Unexpected credential assignment result');
    reassigned = true;
    target = await read(TARGET_PACKAGE);
  }
  assert(matches(target.androidKeystore, EXPECTED_SHA1), 'Final upload certificate does not match Google Play');
  assert(target.androidKeystore.id === source.androidKeystore.id, 'Build must reuse the verified original key record');
  const sourceAfter = await read(SOURCE_PACKAGE);
  assert(sourceAfter.id === source.id && sourceAfter.androidKeystore.id === source.androidKeystore.id, 'Original signing credential unexpectedly changed');
  return { project: PROJECT_NAME, package: TARGET_PACKAGE, sha1: EXPECTED_SHA1, credentialName: target.name, reassigned, originalKeyPreserved: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyAndroidUploadKey({ token: process.env.EXPO_TOKEN, reuseOriginal: process.argv.includes('--reuse-original') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
