import { definePluginApp } from "@get-bb/plugin-sdk/app";

function Jarvis() {
  return <iframe title="Jarvis conversation" src="/api/v1/plugins/jarvis/http/livekit"
    allow="microphone; autoplay" className="h-full min-h-[75vh] w-full border-0" />;
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "jarvis",
    title: "Jarvis",
    icon: "AudioLines",
    path: "staff",
    component: Jarvis,
  });
});
