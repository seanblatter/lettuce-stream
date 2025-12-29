(function (global) {
  const STORAGE_ROOT = 'users';
  const STORAGE_FOLDERS = {
    upload: 'uploads',
    recording: 'recordings'
  };
  const STORAGE_QUOTAS = {
    trial: gbToBytes(20),
    starter: gbToBytes(20),
    pro: gbToBytes(100),
    enterprise: gbToBytes(250)
  };

  const firebaseStorage = typeof firebase !== 'undefined' && typeof firebase.storage === 'function'
    ? firebase.storage()
    : null;
  const firestore = typeof db !== 'undefined' ? db : null;
  const FieldValue = firebase?.firestore?.FieldValue || null;

  if (!firebaseStorage || !firestore || !FieldValue) {
    console.warn('[storage-helpers] Firebase Storage or Firestore is not available.');
    global.storageHelpers = null;
    return;
  }

  function gbToBytes(value) {
    return Math.max(0, Number(value || 0)) * 1024 * 1024 * 1024;
  }

  function sanitizeFileName(name = 'asset') {
    return (String(name)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')) || 'asset';
  }

  function resolvePlanKey(profile = {}) {
    const planValue = String(profile.plan || '').toLowerCase();
    const statusValue = String(profile.status || '').toLowerCase();
    if (planValue.includes('enterprise') || statusValue === 'enterprise') {
      return 'enterprise';
    }
    if (planValue.includes('pro') || statusValue === 'pro') {
      return 'pro';
    }
    if (statusValue === 'trial' || planValue === 'trial') {
      return 'trial';
    }
    if (planValue.includes('starter')) {
      return 'starter';
    }
    return 'starter';
  }

  function getQuotaForPlan(planKey) {
    return STORAGE_QUOTAS[planKey] || STORAGE_QUOTAS.starter;
  }

  async function getStorageContext(userId) {
    ensureUser(userId);
    const userRef = firestore.collection('users').doc(userId);
    const snapshot = await userRef.get();
    const profile = snapshot.exists ? snapshot.data() : {};
    const planKey = resolvePlanKey(profile);
    const quotaBytes = getQuotaForPlan(planKey);
    const usageBytes = Number(profile.storageUsageBytes || 0);
    return { userRef, profile, planKey, quotaBytes, usageBytes };
  }

  async function listAssets(userId) {
    ensureUser(userId);
    const assetsRef = firestore.collection('users').doc(userId).collection('storageAssets');
    const snapshot = await assetsRef.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => normalizeAssetDoc(doc));
  }

  async function uploadAsset(userId, payload, options = {}) {
    ensureUser(userId);
    if (!payload) {
      throw new Error('ASSET_PAYLOAD_REQUIRED');
    }
    const meta = await getStorageContext(userId);
    const fileName = sanitizeFileName(options.fileName || payload.name || 'asset');
    const assetId = options.assetId || `asset_${Date.now()}`;
    const contentType = options.mimeType || payload.type || 'application/octet-stream';
    const sizeBytes = typeof options.sizeBytes === 'number' ? options.sizeBytes : Number(payload.size || 0);
    const nextUsage = meta.usageBytes + sizeBytes;
    if (nextUsage > meta.quotaBytes) {
      throw buildQuotaError(meta.quotaBytes, meta.usageBytes);
    }

    const folder = options.kind === 'recording' ? STORAGE_FOLDERS.recording : STORAGE_FOLDERS.upload;
    const storagePath = `${STORAGE_ROOT}/${userId}/${folder}/${assetId}_${fileName}`;
    const storageRef = firebaseStorage.ref(storagePath);
    await storageRef.put(payload, { contentType });
    const downloadURL = await storageRef.getDownloadURL();

    const assetDoc = {
      id: assetId,
      title: options.title || payload.name || 'Untitled asset',
      mimeType: contentType,
      size: sizeBytes,
      storagePath,
      downloadURL,
      kind: options.kind || 'upload',
      duration: options.durationMs || 0,
      createdAt: FieldValue.serverTimestamp()
    };

    const userAssetsRef = firestore.collection('users').doc(userId).collection('storageAssets');
    await Promise.all([
      userAssetsRef.doc(assetId).set(assetDoc),
      firestore.collection('users').doc(userId).set({
        storageUsageBytes: FieldValue.increment(sizeBytes)
      }, { merge: true })
    ]);

    return {
      ...assetDoc,
      createdAt: new Date().toISOString(),
      downloadURL
    };
  }

  async function deleteAsset(userId, assetId) {
    ensureUser(userId);
    if (!assetId) {
      throw new Error('ASSET_ID_REQUIRED');
    }
    const docRef = firestore.collection('users').doc(userId).collection('storageAssets').doc(assetId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return;
    }
    const data = snapshot.data() || {};
    const sizeBytes = Number(data.size || 0);
    const storagePath = data.storagePath || '';

    if (storagePath) {
      try {
        await firebaseStorage.ref(storagePath).delete();
      } catch (error) {
        console.warn('[storage-helpers] Unable to remove object from storage', error);
      }
    }

    await Promise.all([
      docRef.delete(),
      firestore.collection('users').doc(userId).set({
        storageUsageBytes: FieldValue.increment(-sizeBytes)
      }, { merge: true })
    ]);
  }

  function normalizeAssetDoc(doc) {
    const data = doc.data() || {};
    const createdAt = data.createdAt && typeof data.createdAt.toDate === 'function'
      ? data.createdAt.toDate().toISOString()
      : (data.createdAtIso || new Date().toISOString());
    return {
      id: doc.id,
      title: data.title || 'Untitled asset',
      mimeType: data.mimeType || 'application/octet-stream',
      size: Number(data.size || 0),
      storagePath: data.storagePath || '',
      downloadURL: data.downloadURL || '',
      kind: data.kind || 'upload',
      duration: Number(data.duration || 0),
      createdAt
    };
  }

  function ensureUser(userId) {
    if (!userId) {
      throw new Error('USER_ID_REQUIRED');
    }
  }

  function buildQuotaError(quotaBytes, usageBytes) {
    const error = new Error('Storage quota exceeded');
    error.code = 'STORAGE_QUOTA_EXCEEDED';
    error.details = { quotaBytes, usageBytes };
    return error;
  }

  global.storageHelpers = {
    getStorageContext,
    listAssets,
    uploadAsset,
    deleteAsset,
    getQuotaForPlan
  };
})(typeof window !== 'undefined' ? window : globalThis);
