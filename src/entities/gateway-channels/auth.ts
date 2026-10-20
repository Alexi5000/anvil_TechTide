import { appData } from "@/lib/app-data-store";

export async function loadGatewayToken(): Promise<string> {
  const token = (await appData.readText("gateway-channels/device-token"))?.trim();
  if (!token || token.length < 32 || token.length > 256) {
    throw new Error("Provision this device's gateway token in gateway-channels/device-token before connecting");
  }
  return token;
}
