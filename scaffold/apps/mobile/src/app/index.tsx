import { router } from 'expo-router';
import { useEffect } from 'react';
import { useApp } from '@/AppContext';
import { getActiveProgram } from '@/db/queries';

export default function Index() {
  const { db, userId } = useApp();

  useEffect(() => {
    let live = true;
    (async () => {
      const program = await getActiveProgram(db, userId);
      if (live) router.replace(program ? '/today' : '/onboarding');
    })();
    return () => {
      live = false;
    };
  }, [db, userId]);

  return null;
}
