import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProviderProfile } from '../src/technicians/provider-profile.js';
import { createProviderProfileMarkup } from '../src/technicians/provider-profile-view.js';
import { mockTechnicians } from '../src/technicians/mock-technicians.js';

describe('C09 — hồ sơ kỹ thuật viên', () => {
  const technician = mockTechnicians.find(({ id }) => id === 'lanh-khoa');

  it('construit un ProviderProfile depuis le modèle technicien', () => {
    const profile = createProviderProfile(technician);
    assert.equal(profile.providerId, technician.id);
    assert.equal(profile.name, technician.name);
    assert.equal(profile.rating, technician.rating);
    assert.equal(profile.reviewCount, technician.reviewCount);
    assert.equal(profile.verified, true);
    assert.ok(profile.experienceYears > 0);
    assert.ok(profile.skills.length >= 3);
    assert.ok(profile.reviews.length >= 2);
    assert.ok(Object.isFrozen(profile));
  });

  it('affiche toutes les informations et les deux actions C09', () => {
    const markup = createProviderProfileMarkup(createProviderProfile(technician));
    [
      'Đặng Minh Khoa', '5 · 203 đánh giá', 'Đã xác minh', 'Kỹ thuật điều hòa',
      '9 năm', 'Nha Trang, Khánh Hòa', 'Tiếng Việt', 'Kỹ năng', 'Giới thiệu',
      'Đánh giá gần đây', 'Chọn kỹ thuật viên này', 'Quay lại',
    ].forEach((text) => assert.match(markup, new RegExp(text)));
  });

  it('échappe les données du profil avant rendu', () => {
    const profile = createProviderProfileMarkup({
      providerId: 'x', avatar: { initials: 'X', label: 'Avatar' }, name: '<script>', rating: 5,
      reviewCount: 1, verified: false, specialty: 'Test', experienceYears: 1,
      serviceArea: 'Nha Trang', languages: ['Tiếng Việt'], skills: ['<b>'],
      introduction: '<img>', reviews: [{ customerName: '<i>', rating: 5, comment: '<p>' }],
    });
    assert.doesNotMatch(profile, /<script>|<img>|<b>|<i>/);
  });
});
