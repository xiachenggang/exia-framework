/**
 * 该数据工具类 就是用来解决 服务器数据到游戏DataComp 格式上的统一
 * eg1:对于数组对象 可以转换为一个Map
 */
export class DataCompFormatUtil {
  /**
   * 对象进行赋值
   * 处理
   * 元对象
   * {
   *    k1:v1,
   *    k2:v2
   * }
   * 目标对象
   * {
   *    k1:v1,
   *    k2:v2
   * }
   * */
  static CloneObject(target: Record<string, any>, source: Record<string, any>) {
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
      target[keys[i]] = source[keys[i]];
    }
  }

  /**
   * 处理
   * [
   *    {k1:value,k2:[{k3:value,k4:value}]},
   *    {k1:value,k2:[{k3:value,k4:value}]},
   * ]
   * @param source 需要处理的数据
   * @param target1 将整个对象存起来
   * @param target2 k2:[{k3:value,k4:value}] 将这个里面的数据保存为k,v map
   */
  static ArrayObject2Map(source: any[], target1: any, target2: any) {
    source.forEach((obj: any) => {
      const vs1 = Object.values(obj);
      let map_k1;
      let map_v1: any[] = [];
      for (let i = 0; i < vs1.length; i++) {
        if (Array.isArray(vs1[i])) map_v1 = vs1[i] as any[];
        else map_k1 = vs1[i];
      }
      const list = new Array<number>();
      map_v1.forEach((item: any) => {
        const vs2 = Object.values(item);
        list.push(vs2[0] ?? (0 as any));
        target2.set(vs2[0], vs2[1] ?? 0);
      });
      target1.set(map_k1, list);
    });
  }

  /**
   * 处理
   * [
   *  {k1:v1,K2:v2,...},
   *  ....
   * ]
   * @param source 需要处理的数据
   * @param target 将整个对象存起来
   * @param key 就是source中对象中的任意字段key
   */
  static ArrayObject2MapByKey(source: any[], target: any, key: any) {
    for (let i = 0; i < source.length; i++) {
      target.set(source[i][key], source[i]);
    }
  }

  /**
   * 处理对象数据根据枚举映射到Map中 注意枚举中的值应该跟对象值一一对应
   * 源数据
   * source:Object{
   *  aiActivityRankList: msg_ai_activity.Iai_activity_base[];
   *  aiActivityLimitRechargeList: msg_ai_activity.Iai_activity_base[];
   *  aiActivityLimitGiftList: msg_ai_activity.Iai_activity_base[];
   *  ........
   * }
   *
   * 处理过程：
   * 交给数据自己处理吧
   *
   * 目标数据
   * target:Map<k:v>={
   *  k:enum(type)---->v:aiActivityRankList
   *  ......
   * }
   */
  static ObjectByEnum2Map(source: any, enums: any, target: any) {
    for (let i = 0; i < enums.length; i++) {
      if (source[enums[i].split("_")[2]]) {
        target.RegisterData(
          Number(enums[i].split("_")[0]),
          enums[i],
          source[enums[i].split("_")[2]],
        );
      }
    }
  }

  /**
   * 处理功能开放数据格式
   */
  static StrToArray(str: string, frist = "|", second = ",") {
    const arr = [];
    const temp = str.split(frist);
    for (let i: number = 0; i < temp.length; i++) {
      arr.push(temp[i].split(second));
    }
    return arr;
  }
}
