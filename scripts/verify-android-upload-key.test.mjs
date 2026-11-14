import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAndroidUploadKey, PROJECT_ID, SOURCE_PACKAGE, TARGET_PACKAGE, EXPECTED_SHA1, QUERY, MUTATION } from './verify-android-upload-key.mjs';

const WRONG = '7E:0F:14:AC:AD:92:24:4D:AC:D2:AC:F0:31:3B:52:7C:08:10:58:82';
function mock({ targetCorrect = false, originalSha = EXPECTED_SHA1, projectId = PROJECT_ID, targetSha = WRONG } = {}) {
  let current = targetCorrect ? 'original-key' : 'new-key';
  const writes = [];
  const request = async (query, variables) => {
    if (query === MUTATION) {
      assert.equal(variables.credentialId, 'target-build-credential');
      assert.equal(variables.keystoreId, 'original-key');
      writes.push(variables);
      current = variables.keystoreId;
      return { androidAppBuildCredentials: { setKeystore: { id: variables.credentialId } } };
    }
    assert.equal(query, QUERY);
    assert.equal(variables.projectFullName, '@lilmerge4/home-service-connection');
    const source = variables.applicationIdentifier === SOURCE_PACKAGE;
    assert(source || variables.applicationIdentifier === TARGET_PACKAGE);
    return { app: { byFullName: { id: projectId, androidAppCredentials: [{
      id: source ? 'source-app-credential' : 'target-app-credential',
      applicationIdentifier: variables.applicationIdentifier,
      androidAppBuildCredentialsList: [{
        id: source ? 'source-build-credential' : 'target-build-credential',
        name: source ? 'Original' : 'Corrected package',
        isDefault: true,
        androidKeystore: { id: source ? 'original-key' : current, sha1CertificateFingerprint: source ? originalSha : current === 'original-key' ? EXPECTED_SHA1 : targetSha },
      }],
    }] } } };
  };
  return { request, writes };
}

test('read-only check rejects the wrong upload certificate without changing anything', async () => {
  const fixture = mock();
  await assert.rejects(verifyAndroidUploadKey(fixture), /does not match Google Play/);
  assert.equal(fixture.writes.length, 0);
});
test('explicit repair reuses the matching original key only for the corrected package', async () => {
  const fixture = mock();
  const result = await verifyAndroidUploadKey({ ...fixture, reuseOriginal: true });
  assert.equal(fixture.writes.length, 1);
  assert.equal(result.sha1, EXPECTED_SHA1);
  assert.equal(result.package, TARGET_PACKAGE);
  assert.equal(result.originalKeyPreserved, true);
  assert.equal(result.reassigned, true);
});
test('an already-correct upload key passes with no mutation, including repeated repair', async () => {
  const fixture = mock({ targetCorrect: true });
  assert.equal((await verifyAndroidUploadKey(fixture)).reassigned, false);
  assert.equal((await verifyAndroidUploadKey({ ...fixture, reuseOriginal: true })).reassigned, false);
  assert.equal(fixture.writes.length, 0);
});
test('unexpected Expo project cannot be modified', async () => {
  const fixture = mock({ projectId: 'another-project' });
  await assert.rejects(verifyAndroidUploadKey({ ...fixture, reuseOriginal: true }), /Unexpected Expo project/);
  assert.equal(fixture.writes.length, 0);
});
test('a different original certificate cannot be reused', async () => {
  const fixture = mock({ originalSha: WRONG });
  await assert.rejects(verifyAndroidUploadKey({ ...fixture, reuseOriginal: true }), /Original key does not match/);
  assert.equal(fixture.writes.length, 0);
});
test('unexpected target key prevents reassignment', async () => {
  const fixture = mock({ targetSha: '00:00:00:00' });
  await assert.rejects(verifyAndroidUploadKey({ ...fixture, reuseOriginal: true }), /Target certificate changed unexpectedly/);
  assert.equal(fixture.writes.length, 0);
});
test('credential requests never select private key, password, creation, deletion or rotation fields', () => {
  for (const query of [QUERY, MUTATION]) {
    assert.doesNotMatch(query, /\bkeystore\b|keystorePassword|keyPassword|base64|createAndroid|deleteAndroid|rotate/i);
  }
});
