(function (global) {
  const STORAGE_KEY_PREFIX = 'lettuce-storage::';
  const MAX_ASSETS_PER_USER = 50;

  function resolveKey(userId) {
    return `${STORAGE_KEY_PREFIX}${userId}`;
  }

  function readAssets(userId) {
    if (!userId) {
      return [];
    }
    try {
      const raw = localStorage.getItem(resolveKey(userId));
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('[storage-helpers] Unable to read assets', error);
      return [];
    }
  }

  function writeAssets(userId, assets) {
    if (!userId) {
      return;
    }
    try {
      const payload = JSON.stringify(Array.isArray(assets) ? assets.slice(0, MAX_ASSETS_PER_USER) : []);
      localStorage.setItem(resolveKey(userId), payload);
    } catch (error) {
      console.warn('[storage-helpers] Unable to persist assets', error);
    }
  }

  function addAsset(userId, asset) {
    if (!userId || !asset) {
      return;
    }
    const existing = readAssets(userId);
    existing.unshift(asset);
    writeAssets(userId, existing);
  }

  function deleteAsset(userId, assetId) {
    if (!userId || !assetId) {
      return;
    }
    const nextAssets = readAssets(userId).filter((entry) => entry.id !== assetId);
    writeAssets(userId, nextAssets);
  }

  global.storageHelpers = {
    readAssets,
    writeAssets,
    addAsset,
    deleteAsset
  };
})(typeof window !== 'undefined' ? window : globalThis);
