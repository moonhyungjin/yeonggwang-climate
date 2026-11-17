const nextConfig = {
  experimental: {
    // 엑셀 양식 파일을 서버리스 함수 번들에 포함
    outputFileTracingIncludes: { "/api/excel": ["./templates/**/*"] },
  },
};
export default nextConfig;
