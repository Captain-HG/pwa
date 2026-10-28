import { useRouter } from 'vue-router';

/** 有上一页就返回，否则（如直接刷新了二级页）回首页 */
export function useGoBack() {
  const router = useRouter();
  return () => {
    if (window.history.state?.back) router.back();
    else router.replace('/');
  };
}
