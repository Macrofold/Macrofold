export const themeStorageKey = 'macrofold.theme';
/** Static first-paint bootstrap. Contains no account data or server configuration. */
export const themeBootstrap = `(function(){var t='system';try{var s=localStorage.getItem('${themeStorageKey}');if(s==='light'||s==='dark')t=s}catch(e){}document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t})();`;
