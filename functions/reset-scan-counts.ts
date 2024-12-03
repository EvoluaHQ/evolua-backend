import { getAllUsers, resetScanCount } from './lib/users';

export const handler = async () => {
  const users = await getAllUsers();

  const now = new Date();

  // today in 'YYYY-MM-DD' format
  const today = now.toJSON().slice(0, 10);
  const todayDay = now.getDate();

  for (const user of users) {
    if (user.billingStartDate !== today && isResetDay(user.billingStartDate, todayDay)) {
      await resetScanCount(user.id);
    }    
  }
};

function isResetDay(date: string, day: number) {
  return day === new Date(date).getDate();
}