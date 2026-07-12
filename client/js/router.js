// ============================================================
// ROUTER — gestisce quale "schermata" (div .screen) è visibile
// App single-page senza framework: ogni schermata è un div,
// mostriamo solo quello attivo.
// ============================================================

const Router = {
  show(screenId) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    else console.error(`Schermata non trovata: ${screenId}`);
  },
};
