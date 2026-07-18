import {
  readBoundedRequestBody,
} from "@/modules/http/bounded-request-body";

export { RequestBodyTooLargeError } from "@/modules/http/bounded-request-body";

export async function readBoundedFormData(
  request: Request,
  maxBodyBytes: number,
) {
  const body = await readBoundedRequestBody(request, maxBodyBytes);
  if (!request.body) return request.formData();
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData();
}
