export const supportFaqs = Object.freeze([
  Object.freeze({ question: 'Làm thế nào để đặt dịch vụ?', answer: 'Mô tả vấn đề, chọn kỹ thuật viên phù hợp, xác nhận địa chỉ và gửi yêu cầu đặt dịch vụ.' }),
  Object.freeze({ question: 'Tôi có thể hủy yêu cầu không?', answer: 'Bạn có thể hủy yêu cầu trước khi công việc bắt đầu. Chính sách chi tiết sẽ được bổ sung khi backend được kết nối.' }),
  Object.freeze({ question: 'Giá dịch vụ được xác nhận như thế nào?', answer: 'Kỹ thuật viên gửi chẩn đoán và báo giá. Công việc chỉ bắt đầu sau khi bạn xác nhận báo giá.' }),
  Object.freeze({ question: 'Nếu có chi phí phát sinh thì sao?', answer: 'Mọi chi phí phát sinh được tạo thành một phiên bản báo giá mới và cần sự đồng ý rõ ràng của bạn.' }),
  Object.freeze({ question: 'Tôi có thể liên hệ kỹ thuật viên như thế nào?', answer: 'Trong chuyến đang hoạt động, bạn có thể dùng các nút gọi hoặc nhắn tin hiển thị cùng thông tin kỹ thuật viên.' }),
  Object.freeze({ question: 'Bảo hành hoạt động như thế nào?', answer: 'Thời hạn bảo hành được ghi trong chi tiết chuyến. Quy trình yêu cầu bảo hành sẽ được hoàn thiện trong phiên bản sau.' }),
]);

export const legalContent = Object.freeze({
  terms: Object.freeze({
    title: 'Điều khoản sử dụng',
    sections: Object.freeze([
      Object.freeze({ title: 'Phạm vi dịch vụ', content: 'Nội dung mẫu cho MVP. Điều khoản chính thức về phạm vi và trách nhiệm cung cấp dịch vụ sẽ được bổ sung trước khi phát hành thương mại.' }),
      Object.freeze({ title: 'Trách nhiệm người dùng', content: 'Nội dung mẫu cho MVP. Người dùng cần cung cấp thông tin chính xác và xác nhận rõ các báo giá trước khi công việc bắt đầu.' }),
    ]),
  }),
  privacy: Object.freeze({
    title: 'Chính sách quyền riêng tư',
    sections: Object.freeze([
      Object.freeze({ title: 'Dữ liệu được sử dụng', content: 'Nội dung mẫu cho MVP. Chính sách chính thức sẽ mô tả dữ liệu tài khoản, địa chỉ và lịch sử dịch vụ cần thiết cho hoạt động của HOME AI.' }),
      Object.freeze({ title: 'Lưu trữ và bảo vệ', content: 'Nội dung mẫu cho MVP. Thời hạn lưu trữ, quyền của người dùng và biện pháp bảo vệ dữ liệu sẽ được quy định trong văn bản pháp lý chính thức.' }),
    ]),
  }),
});
