export const mockProviderDashboard = Object.freeze({
  provider: Object.freeze({ id: 'provider-demo', name: 'Nguyễn Văn Minh', specialty: 'Điện dân dụng', kycStatus: 'verified' }),
  status: Object.freeze({ online: true, available: true, lastLocationAt: new Date().toISOString() }),
  offers: Object.freeze([
    Object.freeze({ id: 'offer-demo-1', missionId: 'mission-demo-1', status: 'pending', serviceCategory: 'electricity', request: 'Ổ cắm trong phòng khách bị chập và có mùi khét.', approximateAddress: 'Phước Hải, Nha Trang', address: '12 Nguyễn Trãi, Phước Hải, Nha Trang', clientLocation: Object.freeze({ latitude: 12.2315, longitude: 109.1902 }), distanceKm: 1.8, etaMinutes: 12, expiresAt: new Date(Date.now()+300000).toISOString() }),
    Object.freeze({ id: 'offer-demo-2', missionId: 'mission-demo-2', status: 'pending', serviceCategory: 'appliances', request: 'Máy giặt không xả nước sau khi giặt.', approximateAddress: 'Vĩnh Hải, Nha Trang', distanceKm: 3.4, etaMinutes: 19, expiresAt: new Date(Date.now()+420000).toISOString() }),
  ]),
  assignment: null,
});
