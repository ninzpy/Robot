import { handleWisp } from "../../src/wisp";

export const onRequest = ({ request }: { request: Request }) => handleWisp(request);
