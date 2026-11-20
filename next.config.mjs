const nextConfig = {
  experimental: {
    // 엑셀 양식 파일을 서버리스 함수 번들에 포함
    outputFileTracingIncludes: { "/api/excel": ["./templates/**/*"] },
  },
  webpack: (config) => {
    // pdf.js가 Node용으로 찾는 canvas 모듈은 브라우저에서 쓰지 않음
    config.resolve.alias.canvas = false;
    return config;
  },
};
export default nextConfig;
