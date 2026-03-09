import { useFeatureAccessContext } from '../context/FeatureAccessContext';

export function useFeatureAccess() {
  return useFeatureAccessContext();
}

export default useFeatureAccess;
