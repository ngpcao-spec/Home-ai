const freezeProfile = (profile) => Object.freeze({
  ...profile,
  addresses: Object.freeze(profile.addresses.map((address) => Object.freeze({ ...address }))),
});

const normalizeAddress = (address) => ({
  label: String(address.label ?? '').trim(),
  address: String(address.address ?? '').trim(),
});

const ensureSingleDefault = (addresses, preferredId) => {
  if (!addresses.length) return addresses;
  const defaultId = addresses.some(({ id }) => id === preferredId)
    ? preferredId
    : addresses.find(({ isDefault }) => isDefault)?.id ?? addresses[0].id;
  return addresses.map((address) => ({ ...address, isDefault: address.id === defaultId }));
};

export function createCustomerProfile() {
  return freezeProfile({
    id: 'customer-demo-001',
    name: 'Nguyễn Minh Anh',
    phone: '09•• ••• •••',
    language: 'Tiếng Việt',
    nextAddressId: 2,
    addresses: [{
      id: 'address-1',
      label: 'Nhà',
      address: 'Nha Trang, Khánh Hòa',
      isDefault: true,
    }],
  });
}

export function mergeCustomerProfile(profile, remoteProfile, phone) {
  if (!remoteProfile || remoteProfile.role !== 'customer') return profile;
  return freezeProfile({
    ...profile,
    id: remoteProfile.id ?? profile.id,
    name: String(remoteProfile.name ?? '').trim() || profile.name,
    phone: String(phone ?? '').trim() || profile.phone,
    avatarUrl: remoteProfile.avatarUrl ?? profile.avatarUrl ?? null,
  });
}

export const getDefaultCustomerAddress = (profile) => profile.addresses.find(({ isDefault }) => isDefault) ?? null;

export function addCustomerAddress(profile, address) {
  const normalized = normalizeAddress(address);
  if (!normalized.label || !normalized.address) return profile;
  const id = `address-${profile.nextAddressId}`;
  const makeDefault = Boolean(address.isDefault) || profile.addresses.length === 0;
  const addresses = ensureSingleDefault(
    [...profile.addresses, { id, ...normalized, isDefault: makeDefault }],
    makeDefault ? id : undefined,
  );
  return freezeProfile({ ...profile, nextAddressId: profile.nextAddressId + 1, addresses });
}

export function updateCustomerAddress(profile, id, changes) {
  if (!profile.addresses.some((address) => address.id === id)) return profile;
  const normalized = normalizeAddress(changes);
  if (!normalized.label || !normalized.address) return profile;
  const addresses = profile.addresses.map((address) => (
    address.id === id ? { ...address, ...normalized } : address
  ));
  return freezeProfile({
    ...profile,
    addresses: ensureSingleDefault(addresses, changes.isDefault ? id : undefined),
  });
}

export function setDefaultCustomerAddress(profile, id) {
  if (!profile.addresses.some((address) => address.id === id)) return profile;
  return freezeProfile({ ...profile, addresses: ensureSingleDefault(profile.addresses, id) });
}

export function deleteCustomerAddress(profile, id) {
  const removed = profile.addresses.find((address) => address.id === id);
  if (!removed) return profile;
  const remaining = profile.addresses.filter((address) => address.id !== id);
  return freezeProfile({
    ...profile,
    addresses: ensureSingleDefault(remaining, removed.isDefault ? remaining[0]?.id : undefined),
  });
}
