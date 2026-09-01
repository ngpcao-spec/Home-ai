import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addCustomerAddress,
  createCustomerProfile,
  deleteCustomerAddress,
  getDefaultCustomerAddress,
  mergeCustomerProfile,
  setDefaultCustomerAddress,
  updateCustomerAddress,
} from '../src/customer/profile.js';
import { createCustomerProfileMarkup } from '../src/customer/profile-view.js';

describe('C20 profil client', () => {
  it('centralise les informations client dans CustomerProfile', () => {
    const profile = createCustomerProfile();
    assert.equal(profile.name, 'Nguyễn Minh Anh');
    assert.equal(profile.phone, '09•• ••• •••');
    assert.equal(profile.language, 'Tiếng Việt');
    assert.equal(getDefaultCustomerAddress(profile).address, 'Nha Trang, Khánh Hòa');
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.addresses), true);
  });

  it('fusionne uniquement les champs du profil Supabase sans perdre le fallback local', () => {
    const initial = createCustomerProfile();
    const merged = mergeCustomerProfile(initial, {
      id: 'customer-real-1', role: 'customer', name: 'Trần Thu Hà', avatarUrl: 'https://example.com/avatar.jpg',
    }, '+84912345678');
    assert.equal(merged.id, 'customer-real-1');
    assert.equal(merged.name, 'Trần Thu Hà');
    assert.equal(merged.phone, '+84912345678');
    assert.equal(merged.avatarUrl, 'https://example.com/avatar.jpg');
    assert.deepEqual(merged.addresses, initial.addresses, 'les adresses restent le fallback C20 existant');
    assert.equal(merged.language, initial.language);
    assert.equal(mergeCustomerProfile(initial, { role: 'provider', name: 'Incorrect' }), initial);
  });

  it('ajoute et modifie une adresse sans disperser les données dans la vue', () => {
    const initial = createCustomerProfile();
    const added = addCustomerAddress(initial, { label: 'Văn phòng', address: '12 Trần Phú, Nha Trang' });
    assert.equal(added.addresses.length, 2);
    assert.equal(added.addresses[1].id, 'address-2');
    assert.equal(getDefaultCustomerAddress(added).id, 'address-1');
    const updated = updateCustomerAddress(added, 'address-2', {
      label: 'Công ty',
      address: '20 Trần Phú, Nha Trang',
      isDefault: true,
    });
    assert.equal(updated.addresses[1].label, 'Công ty');
    assert.equal(updated.addresses[1].address, '20 Trần Phú, Nha Trang');
    assert.equal(getDefaultCustomerAddress(updated).id, 'address-2');
    assert.equal(initial.addresses.length, 1, 'le profil initial reste immuable');
  });

  it('garantit au maximum une adresse par défaut lors de chaque opération', () => {
    let profile = createCustomerProfile();
    profile = addCustomerAddress(profile, { label: 'Văn phòng', address: '12 Trần Phú', isDefault: true });
    assert.equal(profile.addresses.filter(({ isDefault }) => isDefault).length, 1);
    assert.equal(getDefaultCustomerAddress(profile).id, 'address-2');
    profile = setDefaultCustomerAddress(profile, 'address-1');
    assert.equal(profile.addresses.filter(({ isDefault }) => isDefault).length, 1);
    assert.equal(getDefaultCustomerAddress(profile).id, 'address-1');
    profile = deleteCustomerAddress(profile, 'address-1');
    assert.equal(profile.addresses.length, 1);
    assert.equal(getDefaultCustomerAddress(profile).id, 'address-2');
    profile = deleteCustomerAddress(profile, 'address-2');
    assert.equal(profile.addresses.length, 0);
    assert.equal(getDefaultCustomerAddress(profile), null);
  });

  it('ignore les adresses invalides ou inconnues', () => {
    const profile = createCustomerProfile();
    assert.equal(addCustomerAddress(profile, { label: '', address: '' }), profile);
    assert.equal(updateCustomerAddress(profile, 'unknown', { label: 'Nhà', address: 'Nha Trang' }), profile);
    assert.equal(setDefaultCustomerAddress(profile, 'unknown'), profile);
    assert.equal(deleteCustomerAddress(profile, 'unknown'), profile);
  });

  it('rend toutes les sections C20 et la navigation vers C19', () => {
    const markup = createCustomerProfileMarkup(createCustomerProfile());
    [
      'Nguyễn Minh Anh',
      '09•• ••• •••',
      'Nha Trang, Khánh Hòa',
      'Tiếng Việt',
      'Thông tin cá nhân',
      'Địa chỉ của tôi',
      'Lịch sử dịch vụ',
      'Trợ giúp &amp; hỗ trợ',
      'Điều khoản &amp; quyền riêng tư',
      'Đăng xuất',
      'data-profile-history',
      'data-add-address',
    ].forEach((text) => assert.match(markup, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  });

  it('rend le formulaire d’ajout ou de modification à partir du modèle', () => {
    const profile = createCustomerProfile();
    const addMarkup = createCustomerProfileMarkup(profile, { addressFormOpen: true });
    assert.match(addMarkup, /Thêm địa chỉ/);
    assert.match(addMarkup, /data-address-form/);
    const editMarkup = createCustomerProfileMarkup(profile, { addressFormOpen: true, editingAddressId: 'address-1' });
    assert.match(editMarkup, /Chỉnh sửa địa chỉ/);
    assert.match(editMarkup, /value="Nha Trang, Khánh Hòa"/);
    assert.match(editMarkup, /checked/);
  });

  it('rend les états de chargement et un avatar Supabase sûr', () => {
    const profile = { ...createCustomerProfile(), avatarUrl: 'https://example.com/avatar.jpg' };
    const markup = createCustomerProfileMarkup(profile, { loadMessage: 'Đang tải hồ sơ...' });
    assert.match(markup, /data-profile-load-status/);
    assert.match(markup, /Đang tải hồ sơ/);
    assert.match(markup, /https:\/\/example\.com\/avatar\.jpg/);
    assert.doesNotMatch(
      createCustomerProfileMarkup({ ...profile, avatarUrl: 'javascript:alert(1)' }),
      /<img/,
    );
  });

  it('n’expose les formulaires persistants que pour une session Supabase', () => {
    const profile = createCustomerProfile();
    assert.doesNotMatch(createCustomerProfileMarkup(profile), /data-profile-personal-form/);
    assert.match(createCustomerProfileMarkup(profile, { canPersist: true }), /data-edit-personal-profile/);
    assert.match(createCustomerProfileMarkup(profile, {
      canPersist: true, personalFormOpen: true, canEditAddresses: false,
    }), /data-profile-personal-form/);
    assert.match(createCustomerProfileMarkup(profile, {
      canPersist: true, personalFormOpen: true, canEditAddresses: false,
    }), /Lưu thông tin cá nhân trước/);
  });
});
