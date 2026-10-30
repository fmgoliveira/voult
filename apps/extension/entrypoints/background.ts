export default defineBackground(() => {
  console.log('Voult background started', { id: browser.runtime.id });
});
