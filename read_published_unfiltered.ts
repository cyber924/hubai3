import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

async function readPublishedUnfiltered() {
  try {
    const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
    const app = initializeApp(config);
    const db = getFirestore(app, config.firestoreDatabaseId);

    console.log("=== READING publishedContents UNFILTERED ===");
    const pubCol = collection(db, 'publishedContents');
    const snapshot = await getDocs(pubCol);
    console.log(`Successfully fetched ${snapshot.docs.length} documents!`);
    snapshot.docs.forEach(doc => {
      console.log(`ID: ${doc.id} | data:`, doc.data());
    });
  } catch (err: any) {
    console.error("Error fetching unfiltered publishedContents:", err.message);
  } finally {
    process.exit(0);
  }
}

readPublishedUnfiltered();
