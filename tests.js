window.MEDICAL_TESTS = {
  'Test admitere': {
    description: 'Verifică ținuta, tatuajele faciale, cazierul, minimum 50 de ore, controlul cu stetoscopul și drug-testul înainte de proba teoretică. Candidatul are voie la maximum 3 greșeli; la a 4-a este respins. Promovare: minimum 17/20.',
    instructions: 'Candidatul trebuie să confirme: „Da, sunt de acord!”. Testerul compară răspunsurile cu ghidul și bifează greșelile. Notează calificativul și folosește /me ADMIS / RESPINS semnat GRAD+NUME.',
    maxWrong: 3,
    questions: [
      ['Este permis unui medic să țină echipament medical asupra sa OFF-DY dacă nu îl folosește?', 'Nu. Este strict interzis.'],
      ['Un medic poate merge cu mașina departamentului OFF-DUTY dacă o duce la garaj sau o mută?', 'Nu. Este interzisă folosirea vehiculelor departamentului OFF-DUTY.'],
      ['Dacă un medic este ON DUTY și nu sunt apeluri, poate juca jocuri de noroc?', 'Nu. Jocurile de noroc sunt interzise ON DUTY.'],
      ['Un medic poate merge în patrulare cu poliția?', 'Nu. Este interzisă patrularea cu poliția.'],
      ['Este permisă o atitudine imatură dacă situația devine tensionată?', 'Nu. Este obligatorie o atitudine matură.'],
      ['Care sunt obligațiile când intrați pe tură?', 'Insignă, uniformă, stația radio pe frecvența 3, pontaj deschis și echipament medical.'],
      ['Este permisă intrarea în departament dacă ai tatuaje pe față, dar le acoperi?', 'Nu. Tatuajele la nivelul feței sunt interzise.'],
      ['Un medic poate refuza un apel dacă nu are chef?', 'Nu. Poate refuza doar în condițiile prevăzute de regulament.'],
      ['La un conflict în care nimeni nu este rănit grav, poți interveni?', 'Nu. Nu intervii și anunți poliția.'],
      ['Ce înseamnă Cod 0, Cod 4 și Cod 78?', 'Cod 0 este urgență, Cod 4 este asistență pentru poliție, Cod 78 este sprijin medical sau unitate adițională.'],
      ['Care sunt condițiile pentru a părăsi departamentul fără sancțiuni?', 'Minimum 14 zile, 1680 minute de pontaj și fără amenzi neplătite.'],
      ['Care este ordinea primului ajutor pentru medici, polițiști și civili?', 'Medici, polițiști, apoi persoane civile.'],
      ['După câte Faction Warn-uri ești demis?', 'La 3 Faction Warn-uri.'],
      ['Poate un medic divulga informații despre intervenții și proceduri?', 'Nu. Informațiile din departament nu se divulgă.'],
      ['Cât poate dura pauza unui medic pe oră?', 'Maximum 5 minute pe oră, nu repetitiv.'],
      ['Poate un fost medic folosi informații interne după ieșirea din departament?', 'Nu. Informațiile interne nu pot fi folosite.'],
      ['Ce trebuie făcut după finalizarea unei intervenții?', 'Se anunță finalizarea apelului și se părăsește zona.'],
      ['Ce joburi sunt permise OFF-DUTY după terminarea programului?', 'Niciun job.'],
      ['Ce armă poate purta un medic în timpul serviciului?', 'Este interzisă orice armă în timpul serviciului; excepția este SNS Pistol OFF-DUTY.'],
      ['Poți oferi bandaj unui civil pentru a trece un obstacol?', 'Nu. Echipamentul medical nu se oferă civililor.']
    ]
  },
  'Test transfer': {
    description: 'Transfer Poliție–Departamentul Medical. Candidatul poate merge pe teren însoțit din prima zi; pentru activitate singur poate susține certificările BLS, RADIO și ALS. Are voie la maximum 2 greșeli; la a 3-a este respins.',
    instructions: 'Citește condițiile în prezența candidatului. Testerul compară răspunsurile cu ghidul și bifează greșelile. Întrebarea deschisă despre motivul alegerii departamentului nu are răspuns corect sau greșit; verifică intenția.',
    maxWrong: 2,
    questions: [
      ['Sunteți de acord să respectați termenii și condițiile Departamentului Medical și să vă asumați repercusiunile?', 'Da.'],
      ['Este permis unui cadru medical să primească atenții de la pacienți?', 'Nu, este strict interzis.'],
      ['Este permis să aibă asupra lui ON-DUTY arme albe sau de foc?', 'Nu.'],
      ['Cât timp trebuie să petreacă minim un cadru medical în departament?', '14 zile, cu minimum 120 minute pe zi și 1680 minute total.'],
      ['Are voie un cadru medical să patruleze cu poliția?', 'Nu.'],
      ['Ce trebuie să facă medicul când intră pe tură?', 'Să deschidă pontajul, să ia insigna și echipamentul și să pornească stația.'],
      ['Au voie medicii să folosească BK-urile?', 'Da. BK 78 pentru sprijin medical și BK 5 pentru echipaj de poliție, conform gradului.'],
      ['Ce face medicul când iese din tură?', 'Lasă echipamentul, închide stația și pontajul și își lasă insigna.'],
      ['Câte minute poate sta în pauză pe tură?', '5 minute.'],
      ['Poate merge cu mașina personală la spital dacă a rămas fără autospecială?', 'Nu. Solicită un coleg sau un taxi.'],
      ['Ce faci dacă un coleg te deranjează prin comportament?', 'Discuți cu gradele superioare.']
    ]
  },
  'Adeverință medicală': {
    description: 'Consult clinic general cu stetoscopul și copie după fișa medicală. Pacientul este respins automat dacă prezintă intoxicație medicamentoasă, intoxicație cu substanțe psihoactive, dependență de droguri, comă alcoolică, boli cu transmitere sexuală, piodermită sau salmonella.',
    instructions: 'Verifică întâi fișa medicală. Dacă există simptome incompatibile, nu continua proba teoretică. Întrebările deschise se evaluează prin argumentare, nu prin copierea exemplelor.',
    questions: [
      ['De ce doriți să obțineți permisul de port-armă?', 'Răspuns deschis: urmărește legalitatea, responsabilitatea și protecția.'],
      ['Cum ar trebui să reacționeze o persoană cu armă într-o situație tensionată?', 'Calm, evită escaladarea și folosește arma doar dacă legea impune.'],
      ['Povestiți o situație în care ați fost pus în pericol și cum ați procedat.', 'Răspuns deschis: urmărește autocontrolul și rezolvarea rațională.'],
      ['Ce înseamnă responsabilitatea de a deține o armă?', 'Respectarea legii, păstrarea în siguranță și folosirea responsabilă.'],
      ['Cum reacționezi dacă o persoană apropiată manipulează periculos o armă?', 'Oprești situația în siguranță și anunți autoritățile dacă este necesar.'],
      ['Ce calități trebuie să aibă o persoană autorizată să dețină o armă?', 'Autocontrol, responsabilitate, disciplină, maturitate și respect pentru lege.']
    ]
  },
  'Test MOTO': {
    description: 'Certificare Moto cu probă teoretică și probă practică. Este disponibilă de la Medic-Rezident; candidatul are nevoie de certificatul S.M.U.L.S. și permis categoria A. Accidentul, căderea, distrugerea motorului sau depășirea condițiilor înseamnă respins.',
    instructions: 'Verifică certificatul SMULS, permisul A, frecvența radio, tunarea unității și condițiile de traseu. Proba teoretică permite 2 greșeli; la a 3-a candidatul este respins.',
    questions: [
      ['Ce faci când ești unitate moto și începe să plouă?', 'Predai unitatea moto.'],
      ['La ce coduri poți interveni ca Medic-Rezident?', 'Cod 4 și BK 78.'],
      ['Poți merge cu unitatea moto la jaf sau răpire fiind grad 300?', 'Doar cu aprobare de la conducere.'],
      ['Câte truse de reparație trebuie să ai minim?', 'Minimum 3.'],
      ['Cine poate conduce ATV-ul?', 'Gradele 200+.'],
      ['Câte cadre medicale pot folosi un motor/ATV?', 'Un motor la 5 cadre medicale.'],
      ['Când ai voie să conduci într-o roată?', 'Nu ai voie.'],
      ['Care este viteza maximă off-road și extrem off-road?', '60–100 km/h off-road și 60 km/h extrem off-road.'],
      ['Este permisă utilizarea motorului fără cască?', 'Nu.'],
      ['Ce ai voie să tunezi la motor/ATV?', 'Doar performanța.']
    ]
  },
  'Test PILOT': {
    description: 'Certificarea Pilot are 4 probe. Verifică licența de pilot. Elicopterul se poate repara după probe, dar dacă motorul ajunge galben/roșu candidatul este respins.',
    instructions: 'Proba teoretică permite o singură greșeală, iar timpul de răspuns este 30 de secunde. Probează locațiile Pacific, pick-up-ul de la Paleto și pick-up-ul de pe Chilliad conform traseului din ghid.',
    questions: [
      ['Un medic grad 200+ poate pilota elicopterul singur?', 'Da.'],
      ['În ce zone poate unitatea aeriană să preia apeluri?', 'În afara orașului sau în zone greu accesibile.'],
      ['Când este permisă intervenția aeriană deasupra unei zone de jaf?', 'După intervenția poliției.'],
      ['Câte unități aeriene pot survola zona unui jaf?', 'O singură unitate.'],
      ['Când este permisă aterizarea pe clădiri fără helipad?', 'Doar la jafuri sau BK-uri.'],
      ['Este permisă părăsirea elicopterului la Sandy pentru apeluri cu autospeciala?', 'Nu.']
    ]
  },
  'Test SMULS': {
    description: 'Certificarea S.M.U.L.S. are două probe: descarcerare și traseu OFF-Road. Verifică testul teoretic, licența navală, permisul categoria B și Stalker-ul full tunat.',
    instructions: 'La descarcerare candidatul alege un număr și efectuează minimum 10 replici /me. Are voie la 2 greșeli; la a 3-a este respins. Traseul are limită de 60 km/h și timp de 5:45 vara sau 6:00 iarna.',
    cases: [
      { title: '1 — Descarcerare verticală fără scurgeri de combustibil', steps: ['/me securizează zona și verifică scurgerile de combustibil', '/me folosește ecosorbentul', '/me montează triunghiurile de blocare', '/me scoate trusa, foarfeca și cleștele hidraulic', '/me analizează daunele majore', '/me deconectează bateria', '/me taie parbrizul și stâlpii A și B', '/me decopertează plafonul', '/me elimină obiectele periculoase', '/me montează vesta KED și gulerul cervical', '/me poziționează targa spinală', '/me extrage lent victima', '/me examinează leziunile', '/me curăță și dezinfectează rănile', '/me aplică atela ghipsată', '/me urcă victima pe targă și în autospecială', '/me conectează pacientul la aparate și monitorizează semnele vitale'] },
      { title: '2 — Descarcerare posterioară', steps: ['/me securizează zona și verifică scurgerile', '/me folosește ecosorbentul', '/me montează triunghiurile de blocare', '/me scoate echipamentul', '/me decupează portbagajul', '/me taie spătarul banchetei', '/me verifică starea de conștiență', '/me ia targa spinală, vesta KED și gulerul cervical', '/me fixează victima', '/me introduce targa sub victimă și o extrage lent', '/me examinează leziunile', '/me curăță și dezinfectează rănile', '/me aplică atela', '/me urcă victima în autospecială', '/me conectează aparatele și monitorizează semnele vitale'] },
      { title: '3 — Descarcerare verticală prin plafon', steps: ['/me securizează zona și verifică scurgerile', '/me montează triunghiurile de blocare', '/me scoate foarfeca, cleștele și fierăstrăul pneumatic', '/me deconectează bateria', '/me taie parbrizul și stâlpii A și B', '/me decopertează plafonul', '/me elimină obiectele periculoase', '/me montează KED și gulerul cervical', '/me poziționează targa spinală', '/me extrage lent victima', '/me examinează leziunile', '/me curăță rănile și aplică atela', '/me urcă victima în autospecială', '/me conectează aparatele și monitorizează pacientul'] },
      { title: '4 — Descarcerare complexă', steps: ['/me securizează zona și verifică scurgerile', '/me folosește ecosorbentul și montează triunghiurile', '/me scoate foarfeca și cleștele hidraulic', '/me analizează daunele', '/me deconectează bateria', '/me taie parbrizul și sparge geamul', '/me taie stâlpul A și deblochează portiera', '/me acționează cricul hidraulic', '/me taie centura și retrage scaunul', '/me montează vesta KED și gulerul cervical', '/me extrage victima', '/me examinează leziunile și aplică atela', '/me urcă victima pe targă și în autospecială', '/me conectează aparatele și monitorizează pacientul'] },
      { title: '5 — Descarcerare de urgență', steps: ['/me securizează zona și verifică scurgerile', '/me oprește activitățile de tăiere', '/me montează triunghiurile și scoate echipamentul', '/me deconectează bateria și creează acces', '/me constată starea victimei', '/me extrage rapid victima din vehicul', '/me începe resuscitarea dacă este inconștientă', '/me execută 30 compresii și 2 ventilații', '/me administrează atropină', '/me montează gulerul cervical', '/me aplică atela și urcă victima pe targă', '/me transportă victima și monitorizează semnele vitale'] }
    ],
  },
  'Test ALS': {
    description: 'Certificare ALS Eclipse. Verifică certificatul BLS, permisul categoria B și faptul că au trecut minimum 3 zile de la ultimul test Radio sau BLS. Candidatul trebuie să efectueze minimum 7 interacțiuni /me la punctul R.A.R.',
    instructions: 'Proba are maximum 2 greșeli; la a 3-a candidatul este respins. Testerul este victima. Verifică folosirea completă a tărgii și cazul ales de candidat. Locația R.A.R.: https://imgur.com/a/KBRtGxU. Parcarea testului: https://imgur.com/a/xAfJ4NC.',
    maxWrong: 2,
    images: [
      { label: 'Punctul R.A.R.', url: 'https://imgur.com/a/KBRtGxU' },
      { label: 'Parcarea testului', url: 'https://imgur.com/a/xAfJ4NC' }
    ],
    cases: [
      { title: 'Cazul 1 — Fractură', minimumMe: 7, steps: ['/me examinează pacientul', '/me verifică prin metoda P.A.S. (Privește, Ascultă, Simte)', '/me observă că are puls', '/me scoate un guler cervical', '/me verifică rănile vizibile', '/me observă fractura', '/me scoate atela ghipsată', '/me montează atela', '/me strânge atela', '/me curăță și dezinfectează rănile', '/me bandajează pacientul', '/me îl ajută să urce pe targă', '/me îl fixează pentru transport'] },
      { title: 'Cazul 2 — Șoc anafilactic', minimumMe: 7, steps: ['/me examinează pacientul', '/me verifică prin metoda P.A.S.', '/me observă că nu respiră', '/me constată blocarea căilor respiratorii', '/me folosește aspiratorul', '/me observă inflamația feței', '/me constată respirația îngreunată', '/me verifică funcțiile vitale', '/me constată șocul anafilactic', '/me pregătește seringa sterilă', '/me administrează hidrocortizon', '/me așteaptă revenirea pacientului', '/me îl pune în poziția de siguranță'] },
      { title: 'Cazul 3 — Arsuri și stop cardio-respirator', minimumMe: 7, steps: ['/me examinează pacientul', '/me verifică prin metoda P.A.S.', '/me observă lipsa pulsului', '/me constată stopul cardio-respirator', '/me scoate defibrilatorul', '/me aplică patch-urile', '/me setează defibrilatorul automat', '/me îl pornește', '/me constată arsurile de gradul 2', '/me aplică Dermazin', '/me aplică folia pentru arsuri', '/me urcă pacientul pe targă', '/me îl fixează în ambulanță', '/me pornește transportul'] },
      { title: 'Cazul 4 — Stop cardio-respirator și traumatism cranian', minimumMe: 7, steps: ['/me examinează pacientul', '/me verifică prin metoda P.A.S.', '/me observă lipsa pulsului', '/me constată stopul cardio-respirator', '/me începe masajul cardiac extern', '/me oferă 30 compresii și 2 ventilații', '/me administrează atropină intravenos', '/me așteaptă revenirea pacientului', '/me îl pune în poziția de siguranță', '/me constată durerile', '/me pregătește morfina', '/me administrează tratamentul', '/me îl urcă pe targă', '/me îl conectează la aparate'] }
    ],
    questions: [
      ['A verificat candidatul certificatul BLS, permisul B și minimum 3 zile de la ultimul Radio/BLS?', 'Da, toate verificările sunt obligatorii.'],
      ['Câte interacțiuni /me sunt necesare pentru promovarea probei practice?', 'Minimum 7 interacțiuni /me.'],
      ['Cine este victima în timpul prezentării cazului?', 'Testerul este victima.'],
      ['Ce trebuie făcut cu targa la destinație?', 'Se deschid ușile, se scoate targa, se blochează roțile și se pune complet în ambulanță.']
    ]
  },
  'Test parașutiști': {
    description: 'Brevet de parașutist. Testul are probă teoretică și probă practică. Teoria permite o greșeală; la a doua este respins. Proba practică nu permite nicio greșeală și necesită filmare.',
    instructions: 'Verifică gradul minim Medic-Specialist, pilotul cu brevet, stația comună și minimum 4 parașute, dintre care 3 pentru candidat. Filmarea este obligatorie pentru validarea aterizărilor.',
    maxWrong: 1,
    images: [],
    practical: [
      { name: 'Săritura ușoară', location: 'Port-avionul de lângă insula exotică', altitude: '1000 m', landing: 'Toată pista port-avionului', images: [] },
      { name: 'Săritura medie', location: 'Lacul Sandy Shores', altitude: '2250–2300 m', landing: 'Zona dintre pontoane', images: [] },
      { name: 'Săritura dificilă', location: 'Centrul orașului / Banca Pacific', altitude: '2500 m', landing: 'Helipadul clădirii A / Pablo', images: [] }
    ],
    questions: [
      ['Care este altitudinea minimă de la care te poți parașuta?', '150 de metri sau înălțimea clădirii G de la Pacific.'],
      ['Ce se întâmplă dacă ai un obiect în mână când te parașutezi?', 'Parașuta nu se deschide, rezultând în comă sau deces.'],
      ['Cum se execută corect săritura și de ce este interzisă alergarea?', 'Se sare simplu, de pe loc; alergarea poate provoca împiedicarea.'],
      ['În ce condiții meteorologice se poate susține testul?', 'Exclusiv pe vreme favorabilă, fără ploaie, ceață sau ninsoare.'],
      ['Care este procedura dacă elicopterul are defecțiuni grave?', 'Pasagerii sar primii, pilotul ultimul după stabilizarea aeronavei.'],
      ['Care este scopul certificatului și ce se întâmplă în caz de abuz?', 'Este pentru jafuri complexe/Cod 0 extins; abuzul poate duce la confiscare și interdicție.']
    ]
  }
};
window.MEDICAL_TESTS = Object.fromEntries(Object.entries(window.MEDICAL_TESTS).map(([name, test]) => ({
  name,
  test: { ...test, questions: test.questions.map(([text, answer]) => ({ text, answer, options: [answer, 'Nu se aplică', 'Răspuns incomplet'] })) }
})).map(({ name, test }) => [name, test]));
