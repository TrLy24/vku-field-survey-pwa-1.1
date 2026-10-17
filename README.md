# VKU Field Survey PWA

## Giới thiệu

Đây là ứng dụng khảo sát thực địa theo hướng PWA (Progressive Web App) dành cho việc ghi nhận nhu cầu việc làm của sinh viên VKU. Ứng dụng có thể hoạt động ngay cả khi không có mạng sau lần truy cập an toàn đầu tiên, lưu bản nháp, lưu phiên khảo sát và ảnh chụp đã nén trong IndexedDB của trình duyệt, đồng thời gửi từng bản ghi khảo sát lên Google Sheets thông qua Google Apps Script khi đã cấu hình xong.

## Tính năng

- Biểu mẫu khảo sát tiếng Việt, thân thiện với màn hình điện thoại và máy tính bảng.
- Gồm các thông tin như người phỏng vấn, người được phỏng vấn, ngày giờ khảo sát, sở thích việc làm, kỹ năng, thách thức và nhu cầu hỗ trợ.
- Quyền truy cập vị trí trên trình duyệt với yêu cầu rõ ràng từ người dùng; tính năng vị trí là tùy chọn và không được yêu cầu ở chế độ nền.
- Hỗ trợ chụp ảnh hoặc chọn ảnh từ thư viện; ảnh được nén theo định dạng JPEG trước khi lưu trong IndexedDB cho đến khi đồng bộ dữ liệu.
- Hỗ trợ nhiều phiên khảo sát độc lập, tự động lưu nháp, trạng thái chờ đồng bộ/đã đồng bộ, nút thử lại và thông báo thành công/lỗi trực quan trên giao diện.
- Service worker lưu trữ shell ứng dụng để có thể mở nhanh offline. Dữ liệu khảo sát và hình ảnh được lưu riêng trong IndexedDB, không lưu trong cache của service worker.
- Google Apps Script ghi từng phiên khảo sát thành một hàng dữ liệu trên bảng tính và có thể lưu một ảnh tùy chọn vào Google Drive của chủ script. Mã yêu cầu lặp lại được xử lý theo kiểu idempotent để tránh trùng dữ liệu.

## Chạy local

Service worker, quyền truy cập máy ảnh và vị trí đều yêu cầu môi trường bảo mật (secure context). Nên dùng `localhost` trong quá trình phát triển thay vì mở trực tiếp file `index.html`.

```sh
npx serve .
```

Sau đó mở địa chỉ `localhost` hoặc HTTPS local trong trình duyệt hỗ trợ. Dự án không cần build, không cần runtime bên thứ ba và không cần tải font từ bên ngoài.

## Kết nối Google Sheets

1. Tạo một bảng tính Google riêng cho dự án. Script sẽ tự động tạo tab `Surveys` và hàng tiêu đề ban đầu.
2. Mở **Extensions → Apps Script**, thay toàn bộ nội dung editor bằng file [`google-apps-script/Code.gs`](./google-apps-script/Code.gs), rồi lưu lại.
3. Trong Apps Script, chọn hàm `setupSpreadsheet` và nhấn **Run** khi project đang mở trong bảng tính đích. Chấp nhận quyền truy cập vào Sheets và Drive được yêu cầu. Thao tác này sẽ lưu ID của bảng tính đích vào Script Properties, giúp Web App không phụ thuộc vào việc bảng tính đang mở hay không.
4. Triển khai (deploy) hoặc cập nhật deployment ở dạng **Web app**. Thiết lập **Execute as** là tài khoản của bạn và **Who has access to the app** là **Anyone** hoặc mức quyền hẹp nhất được hỗ trợ theo môi trường triển khai. Với deployment cũ, hãy chọn **Deploy → Manage deployments → Edit → New version → Deploy**; chỉ lưu code trong editor không đủ để cập nhật phiên bản đang triển khai.
5. Sao chép URL HTTPS đã triển khai, có đuôi `/exec`. Mở URL đó trong trình duyệt: nó sẽ hiển thị thông báo **VKU Survey Sync đang hoạt động**. Nếu báo rằng endpoint chưa được cấu hình, hãy chạy `setupSpreadsheet` và triển khai lại phiên bản mới. Trong PWA, dán URL đó vào phần **Kết nối Google Sheets** rồi lưu.
6. Gửi một khảo sát mẫu và kiểm tra tab `Surveys` (không phải tab mặc định `Sheet1`). Nếu đồng bộ thành công, trạng thái cục bộ sẽ đổi thành **Đã đồng bộ**. Nếu upload thất bại, dữ liệu vẫn nằm trong IndexedDB và có thể thử lại sau.
7. Nếu muốn sheet kết quả công khai theo yêu cầu, hãy chia sẻ bảng tính với quyền **Anyone with the link → Viewer**. Hãy giữ dữ liệu khảo sát ở mức ẩn danh và không lưu thông tin cá nhân nhạy cảm vào sheet có thể xem công khai.

Ứng dụng sẽ gửi dữ liệu theo kiểu HTML form POST tới Google Apps Script Web App, và phản hồi sẽ được xác nhận thông qua `postMessage` để tránh phụ thuộc vào `fetch` cross-origin. Chỉ phản hồi thành công khớp với yêu cầu mới được xem là khảo sát đã đồng bộ. Apps Script kiểm tra ID khảo sát để tránh tạo hàng trùng khi thiết bị lặp lại yêu cầu vì mất phản hồi. Việc mở URL Web App cũng cung cấp một endpoint kiểm tra cơ bản và trạng thái cấu hình bảng tính.

### Quyền riêng tư của sheet công khai và ảnh

Endpoint Web App phải chấp nhận các request ẩn danh để có thể host công khai mà không yêu cầu đăng nhập người dùng. Bất kỳ ai biết URL đều có thể gửi dữ liệu, vì vậy hãy dùng một bảng tính riêng, kiểm tra dữ liệu đầu vào và không thu thập thông tin nhạy cảm. Nếu cần phản hồi bảo mật, hãy hạn chế quyền truy cập và thêm backend có xác thực trước khi triển khai. Quyền viewer công khai trên bảng tính sẽ cho phép xem mọi hàng dữ liệu; Apps Script lưu ảnh vào Google Drive của người sở hữu bảng tính với quyền kiểm soát truy cập bình thường và không tự động công khai ảnh đó.

## Triển khai PWA

Đây là một trang tĩnh; bạn có thể công khai thư mục gốc của dự án lên Cloudflare Pages (tải lên trực tiếp hoặc tích hợp Git) hoặc Vercel. Không cần lệnh build; chỉ cần đặt thư mục đầu ra / root directory là thư mục gốc của repository. Yêu cầu HTTPS cho cài đặt ứng dụng, truy cập máy ảnh và định vị ngoài localhost.

Nếu muốn công khai lên GitHub public, hãy tạo repository rỗng trong tài khoản GitHub của bạn, thêm remote và push dự án lên. Workspace hiện tại có thể chưa được khởi tạo Git hoặc chưa xác thực, nên không thể tự tạo repository public hoặc triển khai hosting gắn với tài khoản của bạn.

## Offline và lưu trữ trên trình duyệt

Shell ứng dụng sẽ được cache sau lần truy cập online đầu tiên. IndexedDB nằm trong hồ sơ trình duyệt và thiết bị: xóa dữ liệu trang web, gỡ cài đặt trình duyệt hoặc mất thiết bị có thể làm mất các khảo sát chưa đồng bộ. Hãy giữ bật lưu trữ của site và đồng bộ các phiên đang chờ khi có kết nối. Tự động đồng bộ sẽ được kích hoạt khi trình duyệt phát ra sự kiện `online` và khi ứng dụng khởi động; người dùng cũng có thể nhấn **Đồng bộ ngay**. Tính năng định vị và máy ảnh vẫn phụ thuộc vào hỗ trợ của trình duyệt và quyền được cấp.

## Cấu trúc dự án

- `index.html`: giao diện chính của ứng dụng.
- `app.js`: xử lý logic ứng dụng, lưu trữ, đồng bộ và gửi dữ liệu.
- `styles.css`: giao diện và định dạng của PWA.
- `sw.js`: service worker cho chế độ offline.
- `manifest.json`: metadata để cài đặt PWA trên thiết bị.
- `google-apps-script/Code.gs`: script Google Apps Script nhận dữ liệu từ app và ghi vào Sheets.
- `icons/`: icon của ứng dụng.

## Lưu ý phát triển

- Chỉ nên chạy và test trên môi trường HTTPS hoặc localhost.
- Khi chỉnh sửa logic đồng bộ dữ liệu, hãy kiểm tra cả trường hợp mất mạng và retry.
- Luôn ưu tiên giữ dữ liệu khảo sát an toàn, tránh thu thập thông tin nhạy cảm vào sheet public.
- Nếu cần mở rộng tính năng, hãy duy trì tối đa tính tương thích với PWA chuẩn của trình duyệt.
>>>>>>> b89edb29ef6a7d94927dfa34e8a3ee59950cea5d
