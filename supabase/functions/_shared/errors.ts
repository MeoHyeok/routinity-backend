// DB/PostgREST 에러 메시지를 그대로 클라이언트에 반환하면 스키마/제약조건
// 이름 같은 내부 구현 정보가 노출될 수 있다. 서버 로그에는 원본을 남기고
// 클라이언트에는 일반화된 메시지만 준다.
export function serverError(error: { message: string }): Response {
  console.error(error.message);
  return Response.json(
    { error: "internal server error" },
    { status: 500 },
  );
}
